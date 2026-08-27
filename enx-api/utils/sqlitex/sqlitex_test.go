package sqlitex

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTableNames(t *testing.T) {
	cases := []struct {
		name  string
		table string
	}{
		{name: "Word", table: (Word{}).TableName()},
		{name: "UserDict", table: (UserDict{}).TableName()},
		{name: "Session", table: (Session{}).TableName()},
		{name: "SyncState", table: (SyncState{}).TableName()},
		{name: "Subscription", table: (Subscription{}).TableName()},
		{name: "CreditAccount", table: (CreditAccount{}).TableName()},
		{name: "CreditTransaction", table: (CreditTransaction{}).TableName()},
		{name: "DictionaryLookupQuota", table: (DictionaryLookupQuota{}).TableName()},
	}
	want := map[string]string{
		"Word":                  "words",
		"UserDict":              "user_dicts",
		"Session":               "sessions",
		"SyncState":             "sync_state",
		"Subscription":          "subscriptions",
		"CreditAccount":         "credit_accounts",
		"CreditTransaction":     "credit_transactions",
		"DictionaryLookupQuota": "dictionary_lookup_quota",
	}
	for _, c := range cases {
		if c.table != want[c.name] {
			t.Errorf("%s.TableName() = %q, want %q", c.name, c.table, want[c.name])
		}
	}
}

func TestInitCreatesDatabaseAndMigratesSchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "enx-sqlitex-init-test.db")
	t.Setenv("DB_PATH", dbPath)

	Init()

	if DB == nil {
		t.Fatal("expected Init to set the package-level DB")
	}
	if GetDB() != DB {
		t.Error("expected GetDB() to return the same *gorm.DB as DB")
	}

	for _, table := range []string{
		"users", "words", "user_dicts", "sessions", "sync_state",
		"subscriptions", "credit_accounts", "credit_transactions", "dictionary_lookup_quota",
	} {
		if !DB.Migrator().HasTable(table) {
			t.Errorf("expected AutoMigrate to create table %q", table)
		}
	}

	if _, err := os.Stat(dbPath); err != nil {
		t.Errorf("expected the db file to exist at %s: %v", dbPath, err)
	}
}

func TestInitCreatesMissingParentDirectory(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nested", "dir", "enx.db")
	t.Setenv("DB_PATH", dbPath)

	Init()

	if DB == nil {
		t.Fatal("expected Init to set the package-level DB even with a missing parent dir")
	}
	if _, err := os.Stat(filepath.Dir(dbPath)); err != nil {
		t.Errorf("expected Init to create the parent directory: %v", err)
	}
}

// repairWordsTableDDLIfNeeded's fast path: a freshly created words table has
// no inline "--" comments in its sqlite_master DDL, so it should return nil
// immediately without attempting the rebuild.
func TestRepairWordsTableDDLIfNeededNoopWhenClean(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "enx-repair-test.db")
	t.Setenv("DB_PATH", dbPath)
	Init()

	if err := repairWordsTableDDLIfNeeded(); err != nil {
		t.Errorf("unexpected error on a clean words table: %v", err)
	}
}
