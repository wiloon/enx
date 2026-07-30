package sqlitex

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRepairWordsTableDDLAndIndex(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	t.Cleanup(func() { DB = nil })

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
	if err := db.Exec(bad).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO words VALUES ('a','Hello',NULL,NULL,NULL,1,100,NULL)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_english ON words(english)`).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.AutoMigrate(&Word{}); err == nil {
		t.Fatal("expected AutoMigrate to fail on commented DDL")
	}

	if err := repairWordsTableDDLIfNeeded(); err != nil {
		t.Fatalf("repair: %v", err)
	}

	var createSQL string
	if err := db.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='words'`).Scan(&createSQL).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(createSQL, "--") {
		t.Fatalf("DDL still has comments: %s", createSQL)
	}

	if err := db.AutoMigrate(&Word{}); err != nil {
		t.Fatalf("AutoMigrate after repair: %v", err)
	}
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_words_english_lower ON words(LOWER(english))").Error; err != nil {
		t.Fatalf("create index: %v", err)
	}

	var idxCount int64
	if err := db.Raw(`SELECT COUNT(*) FROM sqlite_master WHERE name='idx_words_english_lower'`).Scan(&idxCount).Error; err != nil {
		t.Fatal(err)
	}
	if idxCount != 1 {
		t.Fatalf("index missing, count=%d", idxCount)
	}

	var n int64
	if err := db.Raw(`SELECT COUNT(*) FROM words`).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("row count=%d", n)
	}

	// Second call should be a no-op
	if err := repairWordsTableDDLIfNeeded(); err != nil {
		t.Fatalf("second repair: %v", err)
	}
}
