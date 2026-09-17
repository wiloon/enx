package stats

import (
	"context"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

func seedWord(t *testing.T, userID, id, english, chinese string, updatedAt int64) {
	t.Helper()
	cn := chinese
	if err := sqlitex.DB.Save(&sqlitex.Word{
		Id: id, English: english, Chinese: &cn, CreatedAt: updatedAt, UpdatedAt: updatedAt,
	}).Error; err != nil {
		t.Fatalf("seed word: %v", err)
	}
	// Raw INSERT on purpose: gorm unconditionally overwrites a field named
	// UpdatedAt with wall-clock time on Save, so seeding through the model
	// would give every row the same timestamp and make the ordering this
	// test is about untestable. (Same trap ReaderDocument documents by
	// renaming its column-backing field to LastEditedAt.)
	if err := sqlitex.DB.Exec(
		`INSERT INTO user_dicts (user_id, word_id, query_count, already_acquainted, created_at, updated_at)
		 VALUES (?, ?, 2, 0, ?, ?)`,
		userID, id, updatedAt, updatedAt,
	).Error; err != nil {
		t.Fatalf("seed user_dict: %v", err)
	}
}

// seedDay writes a day's row straight to the table, for history older than
// Ingest's plausibility window.
func seedDay(t *testing.T, userID, date string, wordsRead int64) {
	t.Helper()
	if err := sqlitex.DB.Exec(
		`INSERT INTO daily_stats (user_id, date, words_read) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, date) DO UPDATE SET words_read = words_read + excluded.words_read`,
		userID, date, wordsRead,
	).Error; err != nil {
		t.Fatalf("seed day %s: %v", date, err)
	}
}

// A brand-new user must get a complete, zeroed payload -- Home renders its
// onboarding form from this, so a 500 or a null here is a blank first screen.
func TestGetOverviewIsZeroedForANewUser(t *testing.T) {
	ov, err := GetOverview(context.Background(), "u-"+t.Name(), "2026-09-16", now)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	if ov.Today != (Totals{}) || ov.Week != (Totals{}) || ov.Vocab != (Vocab{}) {
		t.Fatalf("new user is not zeroed: %+v", ov)
	}
	if len(ov.Sparkline) != SparklineDays {
		t.Fatalf("sparkline has %d points, want %d", len(ov.Sparkline), SparklineDays)
	}
	if ov.Recent == nil {
		t.Fatal("recent must be [] rather than null")
	}
}

// Missing days have to be plotted as 0, not skipped: a sparkline that drops
// empty days draws a broken streak as an unbroken one.
func TestGetOverviewSparklineIsGapFreeAndEndsToday(t *testing.T) {
	user := "u-" + t.Name()
	mustIngest(t, user, report("s1", "2026-09-16", Delta{WordsRead: 100}))
	mustIngest(t, user, report("s2", "2026-09-15", Delta{WordsRead: 50}))

	ov, err := GetOverview(context.Background(), user, "2026-09-16", now)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	want := []int64{0, 0, 0, 0, 0, 50, 100}
	if len(ov.Sparkline) != len(want) {
		t.Fatalf("sparkline %v", ov.Sparkline)
	}
	for i := range want {
		if ov.Sparkline[i] != want[i] {
			t.Fatalf("sparkline = %v, want %v", ov.Sparkline, want)
		}
	}
}

// 2026-09-16 is a Wednesday, so "this week" reaches back to Monday the 14th
// and must not pick up Sunday the 13th.
func TestGetOverviewWeekStartsMonday(t *testing.T) {
	user := "u-" + t.Name()
	// Seeded directly: Ingest deliberately refuses a date this far from the
	// server's UTC day, so backdated history has to go in under the validator.
	seedDay(t, user, "2026-09-13", 999) // Sunday, the previous week
	seedDay(t, user, "2026-09-14", 10)  // Monday, this week
	mustIngest(t, user, report("w-wed", "2026-09-16", Delta{WordsRead: 5}))

	ov, err := GetOverview(context.Background(), user, "2026-09-16", now)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	if ov.Week.WordsRead != 15 {
		t.Fatalf("week words_read = %d, want 15 (Sunday must not count)", ov.Week.WordsRead)
	}
	if ov.Today.WordsRead != 5 {
		t.Fatalf("today words_read = %d, want 5", ov.Today.WordsRead)
	}
}

func TestGetOverviewVocabAndRecentWords(t *testing.T) {
	user := "u-" + t.Name()
	base := now.UnixMilli()
	seedWord(t, user, "w-"+user+"-1", "serendipity-"+user, "机缘巧合", base-2000)
	seedWord(t, user, "w-"+user+"-2", "obscure-"+user, "晦涩的", base-1000)

	if err := sqlitex.DB.Model(&sqlitex.UserDict{}).
		Where("user_id = ? AND word_id = ?", user, "w-"+user+"-1").
		Update("already_acquainted", 1).Error; err != nil {
		t.Fatalf("mark acquainted: %v", err)
	}

	ov, err := GetOverview(context.Background(), user, "2026-09-16", now)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	if ov.Vocab.Total != 2 || ov.Vocab.Mastered != 1 {
		t.Fatalf("vocab = %+v, want {2 1}", ov.Vocab)
	}
	// Most recently touched first.
	if len(ov.Recent) != 2 || ov.Recent[0].English != "obscure-"+user {
		t.Fatalf("recent = %+v", ov.Recent)
	}
	if ov.Recent[0].Chinese != "晦涩的" {
		t.Fatalf("recent chinese = %q", ov.Recent[0].Chinese)
	}
}

func TestGetSeriesBucketsAndZeroFills(t *testing.T) {
	user := "u-" + t.Name()
	ctx := context.Background()
	seedDay(t, user, "2026-09-14", 10) // Mon, week A
	seedDay(t, user, "2026-09-16", 5)  // Wed, week A
	seedDay(t, user, "2026-09-28", 7)  // Mon, week C

	from := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	points, err := GetSeries(ctx, user, PeriodWeek, from, to)
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if len(points) != 3 {
		t.Fatalf("got %d weekly points, want 3 (the empty middle week must be present)", len(points))
	}
	if points[0].Totals.WordsRead != 15 {
		t.Fatalf("week A = %d, want 15", points[0].Totals.WordsRead)
	}
	if points[1].Totals.WordsRead != 0 {
		t.Fatalf("empty week B = %d, want 0", points[1].Totals.WordsRead)
	}
	if points[2].Totals.WordsRead != 7 {
		t.Fatalf("week C = %d, want 7", points[2].Totals.WordsRead)
	}
}

func TestGetSeriesDayBuckets(t *testing.T) {
	user := "u-" + t.Name()
	seedDay(t, user, "2026-09-15", 42)
	points, err := GetSeries(context.Background(), user, PeriodDay,
		time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 9, 16, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if len(points) != 3 {
		t.Fatalf("got %d daily points, want 3", len(points))
	}
	if points[0].Date != "2026-09-14" || points[1].Totals.WordsRead != 42 || points[2].Totals.WordsRead != 0 {
		t.Fatalf("points = %+v", points)
	}
}

func TestParsePeriod(t *testing.T) {
	if p, err := ParsePeriod(""); err != nil || p != PeriodDay {
		t.Fatalf("empty period should default to day, got %q %v", p, err)
	}
	if _, err := ParsePeriod("fortnight"); err == nil {
		t.Fatal("unknown period should be rejected")
	}
}
