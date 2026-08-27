package sqlitex

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// user_dicts as created by the original P2P-sync migration: inline "--" field
// comments in the DDL that glebarez AutoMigrate mis-parses when it rebuilds
// the table, failing with "table user_dicts__temp has no column named 1" and
// aborting the whole AutoMigrate call before the billing models are reached.
func TestRepairUserDictsTableDDL(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	t.Cleanup(func() { DB = nil })

	bad := `CREATE TABLE user_dicts (
    -- User identifier (UUID)
    user_id TEXT NOT NULL,
    -- Word identifier (UUID, references words.id)
    word_id TEXT NOT NULL,
    -- Query statistics
    query_count INTEGER DEFAULT 0,
    -- Familiarity flag: 0 = learning, 1 = already acquainted
    already_acquainted INTEGER DEFAULT 0,
    -- Timestamps (Unix milliseconds for P2P sync)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    -- Composite primary key
    PRIMARY KEY (user_id, word_id)
)`
	if err := db.Exec(bad).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO user_dicts (user_id, word_id, query_count, already_acquainted, created_at, updated_at) VALUES ('u1','w1',3,1,100,200)`).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.AutoMigrate(&UserDict{}, &Subscription{}, &CreditAccount{}); err == nil {
		t.Fatal("expected AutoMigrate to fail on commented user_dicts DDL")
	}

	if err := repairUserDictsTableDDLIfNeeded(); err != nil {
		t.Fatalf("repair: %v", err)
	}

	var createSQL string
	if err := db.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='user_dicts'`).Scan(&createSQL).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(createSQL, "--") {
		t.Fatalf("DDL still has comments: %s", createSQL)
	}

	// AutoMigrate now completes and reaches the billing models.
	if err := db.AutoMigrate(&UserDict{}, &Subscription{}, &CreditAccount{}, &CreditTransaction{}, &DictionaryLookupQuota{}); err != nil {
		t.Fatalf("AutoMigrate after repair: %v", err)
	}
	for _, tbl := range []string{"subscriptions", "credit_accounts", "credit_transactions", "dictionary_lookup_quota"} {
		var n int64
		if err := db.Raw(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&n).Error; err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("table %s not created after repair", tbl)
		}
	}

	// Row preserved, values intact.
	var ud UserDict
	if err := db.Raw(`SELECT * FROM user_dicts WHERE user_id='u1' AND word_id='w1'`).Scan(&ud).Error; err != nil {
		t.Fatal(err)
	}
	if ud.QueryCount != 3 || ud.AlreadyAcquainted != 1 || ud.CreatedAt != 100 || ud.UpdatedAt != 200 {
		t.Fatalf("row not preserved: %+v", ud)
	}

	// Second call is a no-op.
	if err := repairUserDictsTableDDLIfNeeded(); err != nil {
		t.Fatalf("second repair: %v", err)
	}
}
