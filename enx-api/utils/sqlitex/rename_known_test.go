package sqlitex

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	t.Cleanup(func() { DB = nil })
	return db
}

// #135: user_dicts.already_acquainted is renamed to known in place, keeping
// each user's flag.
func TestRenameUserDictsKnownColumn_KeepsTheFlag(t *testing.T) {
	db := openTestDB(t)
	if err := db.Exec(`CREATE TABLE user_dicts (
		user_id TEXT NOT NULL, word_id TEXT NOT NULL,
		query_count INTEGER DEFAULT 0, already_acquainted INTEGER DEFAULT 0,
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, word_id))`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO user_dicts VALUES ('u1','w1',3,1,100,200), ('u1','w2',1,0,100,200)`).Error; err != nil {
		t.Fatal(err)
	}

	if err := renameUserDictsKnownColumn(); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if err := db.AutoMigrate(&UserDict{}); err != nil {
		t.Fatalf("AutoMigrate after rename: %v", err)
	}

	var rows []UserDict
	if err := db.Order("word_id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || !rows[0].Known || rows[1].Known || rows[0].QueryCount != 3 {
		t.Fatalf("rows after rename: %+v", rows)
	}
	if db.Migrator().HasColumn(&UserDict{}, "already_acquainted") {
		t.Fatal("already_acquainted still present")
	}

	// A second start is a no-op.
	if err := renameUserDictsKnownColumn(); err != nil {
		t.Fatalf("second rename: %v", err)
	}
}

func TestRenameUserDictsKnownColumn_FreshDatabase(t *testing.T) {
	openTestDB(t)
	if err := renameUserDictsKnownColumn(); err != nil {
		t.Fatalf("rename on a database without user_dicts: %v", err)
	}
}
