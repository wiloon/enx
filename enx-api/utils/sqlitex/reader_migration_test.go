package sqlitex

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestReaderDocumentsAddsUpdatedAtColumnAndBackfillsExistingRows reproduces a
// real incident: a reader_documents table created before the updated_at
// column existed (and already holding rows) failed AutoMigrate with "Cannot
// add a NOT NULL column with default value NULL" -- SQLite refuses to add a
// NOT NULL column with no default to a non-empty table. Every /api/reader/*
// endpoint touching that column then 500'd with "no such column: updated_at"
// (see docs/architecture/adr-022-enx-ui-reader-persistence-and-retention.md
// Addendum 1). The fix is the `default:0` gorm tag on
// ReaderDocument.LastEditedAt plus the one-time backfill in Init.
func TestReaderDocumentsAddsUpdatedAtColumnAndBackfillsExistingRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	t.Cleanup(func() { DB = nil })

	// Simulate the pre-existing production schema: reader_documents from
	// before the updated_at column existed, already holding a row.
	old := `CREATE TABLE reader_documents (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		content TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	)`
	if err := db.Exec(old).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO reader_documents (id, user_id, content, created_at, expires_at) VALUES ('doc-1', 'u1', 'legacy content', 1000, 2000)`).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.AutoMigrate(&ReaderDocument{}); err != nil {
		t.Fatalf("AutoMigrate should add the missing NOT NULL column via its default:0, got: %v", err)
	}

	if result := db.Exec("UPDATE reader_documents SET updated_at = created_at WHERE updated_at = 0"); result.Error != nil {
		t.Fatalf("backfill: %v", result.Error)
	}

	var updatedAt int64
	if err := db.Raw(`SELECT updated_at FROM reader_documents WHERE id = 'doc-1'`).Scan(&updatedAt).Error; err != nil {
		t.Fatal(err)
	}
	if updatedAt != 1000 {
		t.Fatalf("got updated_at=%d, want 1000 (backfilled from created_at)", updatedAt)
	}
}
