package sqlitex

import (
	"path/filepath"
	"regexp"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func wordsDDL(t *testing.T) string {
	t.Helper()
	var ddl string
	if err := DB.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='words'`).Scan(&ddl).Error; err != nil {
		t.Fatal(err)
	}
	return ddl
}

func count(t *testing.T, table string) int64 {
	t.Helper()
	var n int64
	if err := DB.Table(table).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

var englishNoCase = regexp.MustCompile("(?i)`?english`?[^,]*COLLATE NOCASE")

// ADR-043: words.english matches ECDICT's stardict.word -- case-insensitive
// and unique, so a word has one row whatever its case.
func TestInitWordsEnglishIsCaseInsensitiveAndUnique(t *testing.T) {
	t.Setenv("DB_PATH", filepath.Join(t.TempDir(), "enx.db"))
	Init()

	if !englishNoCase.MatchString(wordsDDL(t)) {
		t.Fatalf("words.english is not COLLATE NOCASE: %s", wordsDDL(t))
	}
	if err := DB.Exec(`INSERT INTO words (id, english, created_at, updated_at) VALUES ('w1', 'Apple', 1, 1)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := DB.Exec(`INSERT INTO words (id, english, created_at, updated_at) VALUES ('w2', 'apple', 1, 1)`).Error; err == nil {
		t.Fatal("inserted 'apple' next to 'Apple': english is not unique case-insensitively")
	}
	var id string
	DB.Raw(`SELECT id FROM words WHERE english = 'APPLE'`).Scan(&id)
	if id != "w1" {
		t.Fatalf("english = 'APPLE' found %q, want w1", id)
	}
}

// A database from before ADR-043 (case-sensitive english) is migrated by
// clearing words and the table that references it, then rebuilding words.
// Other tables are untouched, and a second start changes nothing.
func TestInitMigratesCaseSensitiveWords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "enx.db")
	old, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`CREATE TABLE words (id TEXT PRIMARY KEY, english TEXT NOT NULL UNIQUE, chinese TEXT, pronunciation TEXT,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, load_count INTEGER NOT NULL DEFAULT 0)`,
		`CREATE INDEX idx_words_english_lower ON words(LOWER(english))`,
		`INSERT INTO words (id, english, created_at, updated_at) VALUES ('w1', 'US', 1, 1), ('w2', 'us', 1, 1)`,
		`CREATE TABLE user_dicts (user_id TEXT NOT NULL, word_id TEXT NOT NULL, query_count INTEGER DEFAULT 0,
			already_acquainted INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, word_id))`,
		`INSERT INTO user_dicts (user_id, word_id, created_at, updated_at) VALUES ('u1', 'w1', 1, 1)`,
		`CREATE TABLE users (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT, email TEXT, password TEXT, status TEXT)`,
		`INSERT INTO users (id, email) VALUES ('u1', 'a@example.com')`,
	} {
		if err := old.Exec(stmt).Error; err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	sqlDB, _ := old.DB()
	sqlDB.Close()

	t.Setenv("DB_PATH", path)
	Init()

	if !englishNoCase.MatchString(wordsDDL(t)) {
		t.Fatalf("words not rebuilt with COLLATE NOCASE: %s", wordsDDL(t))
	}
	if w, u := count(t, "words"), count(t, "user_dicts"); w != 0 || u != 0 {
		t.Fatalf("after migration: %d words, %d user_dicts; want both cleared", w, u)
	}
	if n := count(t, "users"); n != 1 {
		t.Fatalf("users: %d rows, want the 1 untouched", n)
	}
	var lowerIdx int64
	DB.Raw(`SELECT count(*) FROM sqlite_master WHERE name = 'idx_words_english_lower'`).Scan(&lowerIdx)
	if lowerIdx != 0 {
		t.Fatal("idx_words_english_lower survived; it is redundant with a NOCASE column")
	}

	// Idempotent: data written after the migration survives the next start.
	if err := DB.Exec(`INSERT INTO words (id, english, created_at, updated_at) VALUES ('w3', 'run', 1, 1)`).Error; err != nil {
		t.Fatal(err)
	}
	Init()
	if n := count(t, "words"); n != 1 {
		t.Fatalf("second start: %d words, want the row written after the migration", n)
	}
}
