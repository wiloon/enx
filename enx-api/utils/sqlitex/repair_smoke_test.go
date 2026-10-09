package sqlitex

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// P2P-era databases (migrations/20251230_migrate_words_to_p2p.sql) have a
// words table whose CREATE TABLE embeds "--" comments. glebarez AutoMigrate
// can't rewrite that SQL, and its failure aborted the whole AutoMigrate call,
// so the billing tables listed after Word were never created. Since ADR-043
// the NOCASE migration rebuilds such a table (it is case-sensitive too), so
// Init must come out with a clean words table and every later table present.
func TestInitHandlesCommentedP2PWordsTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	bad := `CREATE TABLE "words" (
    id TEXT PRIMARY KEY,                    -- UUID instead of auto-increment
    english TEXT NOT NULL,                   -- Original field
    chinese TEXT,                            -- Original field
    pronunciation TEXT,                      -- Original field
    created_at INTEGER,                      -- Unix timestamp
    load_count INTEGER NOT NULL DEFAULT 0,   -- Original field
    updated_at INTEGER NOT NULL,             -- required
    deleted_at INTEGER                       -- Soft delete
)`
	for _, stmt := range []string{bad,
		`INSERT INTO words VALUES ('a','Hello',NULL,NULL,NULL,1,100,NULL)`,
		`CREATE UNIQUE INDEX idx_english ON words(english)`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	sqlDB, _ := db.DB()
	sqlDB.Close()

	Init(path)

	if ddl := wordsDDL(t); strings.Contains(ddl, "--") || !englishNoCase.MatchString(ddl) {
		t.Fatalf("words not rebuilt cleanly: %s", ddl)
	}
	for _, table := range []string{"subscriptions", "credit_accounts", "credit_transactions", "dictionary_lookup_quota"} {
		if !DB.Migrator().HasTable(table) {
			t.Errorf("AutoMigrate stopped before %s", table)
		}
	}
}
