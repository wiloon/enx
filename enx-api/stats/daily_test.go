package stats

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"enx-api/utils"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-stats-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	os.Exit(m.Run())
}

var now = time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)

func report(id, date string, d Delta) Report {
	return Report{ClientEventID: id, LocalDate: date, UTCOffsetMinutes: 480, Delta: d}
}

func mustIngest(t *testing.T, userID string, r Report) bool {
	t.Helper()
	applied, err := Ingest(context.Background(), userID, r, now)
	if err != nil {
		t.Fatalf("Ingest(%s): %v", r.ClientEventID, err)
	}
	return applied
}

func day(t *testing.T, userID, date string) Totals {
	t.Helper()
	totals, err := sumRange(context.Background(), userID, date, date)
	if err != nil {
		t.Fatalf("sumRange: %v", err)
	}
	return totals
}

func TestIngestAccumulatesDeltas(t *testing.T) {
	user := "u-" + t.Name()
	mustIngest(t, user, report("e1", "2026-09-16", Delta{WordsRead: 300, ArticlesRead: 1, WordLookups: 4}))
	mustIngest(t, user, report("e2", "2026-09-16", Delta{WordsRead: 120, WordLookups: 2, NewWords: 3}))

	got := day(t, user, "2026-09-16")
	if got.WordsRead != 420 || got.ArticlesRead != 1 || got.WordLookups != 6 || got.NewWords != 3 {
		t.Fatalf("after two reports: %+v", got)
	}
}

// The whole point of the dedup log: a client that retries a report whose
// response it never saw must not double its own numbers.
func TestIngestIsIdempotentPerClientEventID(t *testing.T) {
	user := "u-" + t.Name()
	if !mustIngest(t, user, report("dup", "2026-09-16", Delta{WordsRead: 500})) {
		t.Fatal("first report should have applied")
	}
	if mustIngest(t, user, report("dup", "2026-09-16", Delta{WordsRead: 500})) {
		t.Fatal("replay should report applied=false")
	}
	if got := day(t, user, "2026-09-16").WordsRead; got != 500 {
		t.Fatalf("words_read = %d after replay, want 500", got)
	}
}

func TestIngestRejectsImplausibleLocalDate(t *testing.T) {
	user := "u-" + t.Name()
	for _, date := range []string{"2026-09-20", "2026-09-01", "not-a-date", ""} {
		if _, err := Ingest(context.Background(), user, report("x"+date, date, Delta{WordsRead: 1}), now); err == nil {
			t.Fatalf("date %q should have been rejected", date)
		}
	}
	// One day either side of the UTC date is a real timezone, not a forgery.
	for _, date := range []string{"2026-09-15", "2026-09-17"} {
		if _, err := Ingest(context.Background(), user, report("ok"+date, date, Delta{WordsRead: 1}), now); err != nil {
			t.Fatalf("date %q should have been accepted: %v", date, err)
		}
	}
}

func TestIngestRequiresEventID(t *testing.T) {
	if _, err := Ingest(context.Background(), "u", report("", "2026-09-16", Delta{WordsRead: 1}), now); err != ErrMissingEventID {
		t.Fatalf("want ErrMissingEventID, got %v", err)
	}
}

func TestIngestClampsAndDropsNegatives(t *testing.T) {
	user := "u-" + t.Name()
	mustIngest(t, user, report("huge", "2026-09-16", Delta{
		WordsRead:   maxWordsPerReport() + 1_000_000,
		WordLookups: -5,
	}))

	got := day(t, user, "2026-09-16")
	if got.WordsRead != maxWordsPerReport() {
		t.Fatalf("words_read = %d, want the cap %d", got.WordsRead, maxWordsPerReport())
	}
	if got.WordLookups != 0 {
		t.Fatalf("a negative delta must not subtract, got %d", got.WordLookups)
	}
}

// An all-zero report is a no-op, not a stored row and not an error -- the
// client should be able to flush an empty queue without consequence.
func TestIngestIgnoresEmptyDelta(t *testing.T) {
	user := "u-" + t.Name()
	if applied := mustIngest(t, user, report("empty", "2026-09-16", Delta{})); applied {
		t.Fatal("an empty delta should not apply")
	}
	if got := day(t, user, "2026-09-16"); got != (Totals{}) {
		t.Fatalf("empty delta wrote %+v", got)
	}
}

func TestAddLookupCountsUnderTheGivenLocalDay(t *testing.T) {
	user := "u-" + t.Name()
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := AddLookup(ctx, user, "2026-09-16", 480); err != nil {
			t.Fatalf("AddLookup: %v", err)
		}
	}
	if got := day(t, user, "2026-09-16").WordLookups; got != 3 {
		t.Fatalf("word_lookups = %d, want 3", got)
	}

	// The same instant is a different local day either side of the date line,
	// which is exactly why the client's offset decides the bucket.
	if err := AddLookup(ctx, user, "2026-09-17", -720); err != nil {
		t.Fatalf("AddLookup: %v", err)
	}
	if got := day(t, user, "2026-09-17").WordLookups; got != 1 {
		t.Fatalf("next day word_lookups = %d, want 1", got)
	}
}

func TestPurgeIngestLogKeepsRecentRows(t *testing.T) {
	user := "u-" + t.Name()
	mustIngest(t, user, report("fresh-"+user, "2026-09-16", Delta{WordsRead: 10}))

	// Nothing to purge yet.
	if deleted, err := PurgeIngestLog(context.Background(), now); err != nil || deleted != 0 {
		t.Fatalf("PurgeIngestLog early: deleted=%d err=%v", deleted, err)
	}

	// Past the TTL the dedup row goes, and a replay is applied again -- that
	// is the accepted trade: the TTL only has to outlive the retry window.
	later := now.Add(IngestLogTTL() + time.Hour)
	if _, err := PurgeIngestLog(context.Background(), later); err != nil {
		t.Fatalf("PurgeIngestLog late: %v", err)
	}
	var remaining int64
	sqlitex.DB.Table("stats_ingest_log").Where("client_event_id = ?", "fresh-"+user).Count(&remaining)
	if remaining != 0 {
		t.Fatalf("expired dedup row survived the purge")
	}
}
