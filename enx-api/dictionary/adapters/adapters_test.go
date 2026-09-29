package adapters

import (
	"context"
	"path/filepath"
	"testing"

	"enx-api/dictionary"
	"enx-api/ecdict"
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
	path := filepath.Join(t.TempDir(), "ecdict.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE stardict (word TEXT, sw TEXT, phonetic TEXT, translation TEXT, exchange TEXT)`).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if err := db.Exec(`INSERT INTO stardict VALUES (?, ?, ?, ?, ?)`, r[0], r[1], r[2], r[3], r[4]).Error; err != nil {
			t.Fatal(err)
		}
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.Close()
	ecdict.Init(path)
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
	for _, english := range []string{"run", "ran"} {
		if got, ok := (Ecdict{}).Lookup(ctx, english); !ok || got != want {
			t.Fatalf("Lookup(%q) = %+v, %v; want %+v", english, got, ok, want)
		}
	}
	if _, ok := (Ecdict{}).Lookup(ctx, "zzxqv"); ok {
		t.Fatal("Lookup(zzxqv) found something")
	}
}

func TestEcdictUnavailable(t *testing.T) {
	ecdict.Init("")
	if (Ecdict{}).Available() {
		t.Fatal("Available() = true with no database configured")
	}
}
