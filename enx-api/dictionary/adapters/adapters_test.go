package adapters

import (
	"context"
	"errors"
	"testing"

	"enx-api/dictionary"
	"enx-api/ecdict"
	"enx-api/ecdict/ecdicttest"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupWordsDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.Word{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func seedWord(t *testing.T, english, chinese string) string {
	t.Helper()
	id := uuid.NewString()
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: id, English: english, Chinese: &chinese, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	return id
}

// setupEcdict opens a throwaway stardict holding rows ({word, sw, phonetic,
// translation, exchange}).
func setupEcdict(t *testing.T, rows ...[5]string) {
	t.Helper()
	var rs []ecdicttest.Row
	for _, r := range rows {
		rs = append(rs, ecdicttest.Row{Word: r[0], Sw: r[1], Phonetic: r[2], Translation: r[3], Exchange: r[4]})
	}
	ecdict.Init(ecdicttest.Create(t, rs...))
	t.Cleanup(func() { ecdict.Init("") })
}

func TestWordsTableFind(t *testing.T) {
	setupWordsDB(t)
	id := seedWord(t, "serendipity", "机缘巧合")
	ctx := context.Background()

	for _, english := range []string{"serendipity", "Serendipity"} {
		gotID, entry, ok, err := WordsTable{}.Find(ctx, english)
		if err != nil || !ok || gotID != id || entry.Chinese != "机缘巧合" {
			t.Fatalf("Find(%q) = %q, %+v, %v, %v; want row %s", english, gotID, entry, ok, err, id)
		}
	}
	if _, _, ok, err := (WordsTable{}).Find(ctx, "zzxqv"); ok || err != nil {
		t.Fatalf("Find(zzxqv): ok=%v err=%v, want a clean miss", ok, err)
	}
}

func TestWordsTableAddReturnsExistingRowForCachedHeadword(t *testing.T) {
	setupWordsDB(t)
	ctx := context.Background()

	id, err := WordsTable{}.Add(ctx, dictionary.Entry{English: "run", Chinese: "v. 跑"})
	if err != nil || id == "" {
		t.Fatalf("first Add: %q, %v", id, err)
	}
	again, err := WordsTable{}.Add(ctx, dictionary.Entry{English: "run", Chinese: "v. 跑"})
	if err != nil || again != id {
		t.Fatalf("second Add: %q, %v; want the existing id %s", again, err, id)
	}
}

func TestEcdictLookup(t *testing.T) {
	setupEcdict(t, [5]string{"run", "run", "rʌn", "v. 跑", "p:ran/d:run/i:running/3:runs"})
	ctx := context.Background()

	if !(Ecdict{}).Available() {
		t.Fatal("Available() = false with a database configured")
	}
	want := dictionary.Entry{English: "run", Chinese: "v. 跑", Pronunciation: "rʌn"}
	for _, english := range []string{"run", "RUN", "ran"} {
		if got, err := (Ecdict{}).Lookup(ctx, english); err != nil || got != want {
			t.Fatalf("Lookup(%q) = %+v, %v; want %+v", english, got, err, want)
		}
	}
	if _, err := (Ecdict{}).Lookup(ctx, "zzxqv"); !errors.Is(err, dictionary.ErrNotInDictionary) {
		t.Fatalf("Lookup(zzxqv) = %v, want ErrNotInDictionary", err)
	}
}

// A lookup the caller abandoned surfaces as the context error (labelled "error").
func TestEcdictLookupFailures(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	setupEcdict(t, [5]string{"run", "run", "", "v. 跑", ""})
	if _, err := (Ecdict{}).Lookup(ctx, "zzxqv"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled: got %v, want context.Canceled", err)
	}
}

func TestEcdictUnavailable(t *testing.T) {
	ecdict.Init("")
	if (Ecdict{}).Available() {
		t.Fatal("Available() = true with no database configured")
	}
}
