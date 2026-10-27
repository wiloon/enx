package sqlitex

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
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
		{name: "LookupEvent", table: (LookupEvent{}).TableName()},
	}
	want := map[string]string{
		"Word":              "words",
		"UserDict":          "user_dicts",
		"Session":           "sessions",
		"SyncState":         "sync_state",
		"Subscription":      "subscriptions",
		"CreditAccount":     "credit_accounts",
		"CreditTransaction": "credit_transactions",
		"LookupEvent":       "lookup_events",
	}
	for _, c := range cases {
		if c.table != want[c.name] {
			t.Errorf("%s.TableName() = %q, want %q", c.name, c.table, want[c.name])
		}
	}
}

func TestInitCreatesDatabaseAndMigratesSchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "enx-sqlitex-init-test.db")

	Init(dbPath)

	if DB == nil {
		t.Fatal("expected Init to set the package-level DB")
	}

	for _, table := range []string{
		"users", "words", "user_dicts", "sessions", "sync_state",
		"subscriptions", "credit_accounts", "credit_transactions", "lookup_events",
		"active_users_daily", "referral_codes", "referrals",
	} {
		if !DB.Migrator().HasTable(table) {
			t.Errorf("expected AutoMigrate to create table %q", table)
		}
	}

	if _, err := os.Stat(dbPath); err != nil {
		t.Errorf("expected the db file to exist at %s: %v", dbPath, err)
	}
}

// ADR-059 Decision 5: lookup_events replaced dictionary_lookup_quota, and an
// existing database's quota table is dropped, not migrated.
func TestInitDropsTheOldLookupQuotaTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "enx-sqlitex-drop-quota-test.db")
	old, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := old.Exec(`CREATE TABLE dictionary_lookup_quota (user_id TEXT, date TEXT, count INTEGER)`).Error; err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := old.DB(); err == nil {
		_ = sqlDB.Close()
	}

	Init(dbPath)

	if DB.Migrator().HasTable("dictionary_lookup_quota") {
		t.Fatal("dictionary_lookup_quota still exists after Init")
	}
}

// The DSN pragmas are parsed by the sqlite driver (glebarez/go-sqlite on top
// of modernc.org/sqlite). A driver upgrade that stops honoring the
// "_pragma=" query syntax would silently drop WAL and busy_timeout, which the
// credit ledger's concurrent writers depend on (see the comment in Init).
func TestInitAppliesDSNPragmas(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "enx-sqlitex-pragma-test.db")

	Init(dbPath)

	if DB == nil {
		t.Fatal("expected Init to set the package-level DB")
	}

	var journalMode string
	if err := DB.Raw("PRAGMA journal_mode").Scan(&journalMode).Error; err != nil {
		t.Fatalf("PRAGMA journal_mode: %v", err)
	}
	if journalMode != "wal" {
		t.Errorf("journal_mode = %q, want %q", journalMode, "wal")
	}

	var busyTimeout int
	if err := DB.Raw("PRAGMA busy_timeout").Scan(&busyTimeout).Error; err != nil {
		t.Fatalf("PRAGMA busy_timeout: %v", err)
	}
	if busyTimeout != 10000 {
		t.Errorf("busy_timeout = %d, want 10000", busyTimeout)
	}

	// synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA.
	var synchronous int
	if err := DB.Raw("PRAGMA synchronous").Scan(&synchronous).Error; err != nil {
		t.Fatalf("PRAGMA synchronous: %v", err)
	}
	if synchronous != 1 {
		t.Errorf("synchronous = %d, want 1 (NORMAL)", synchronous)
	}
}

func TestInitCreatesMissingParentDirectory(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nested", "dir", "enx.db")

	Init(dbPath)

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
func TestMigrateWordsEnglishNoCaseNoopWhenMigrated(t *testing.T) {
	Init(filepath.Join(t.TempDir(), "enx-repair-test.db"))

	if err := migrateWordsEnglishNoCase(); err != nil {
		t.Errorf("unexpected error on an already-migrated words table: %v", err)
	}
}

// Words cached from ECDICT before ecdict.CleanPhonetic existed get their
// corrupted long schwa repaired; every other row, updated_at included, is
// left alone.
func TestCleanCachedEcdictPhonetics(t *testing.T) {
	Init(filepath.Join(t.TempDir(), "enx-phonetic-test.db"))

	pron := func(s string) *string { return &s }
	rows := []Word{
		{Id: "w1", English: "universally", Pronunciation: pron(`ju:ni'v\\:sәli`), CreatedAt: 1, UpdatedAt: 1},
		{Id: "w2", English: "nurse", Pronunciation: pron("nә:s"), CreatedAt: 1, UpdatedAt: 1},
		{Id: "w3", English: "nothing", CreatedAt: 1, UpdatedAt: 1},
	}
	if err := DB.Create(&rows).Error; err != nil {
		t.Fatalf("seed words: %v", err)
	}

	if err := cleanCachedEcdictPhonetics(); err != nil {
		t.Fatalf("cleanCachedEcdictPhonetics: %v", err)
	}

	want := map[string]*string{"w1": pron("ju:ni'vә:sәli"), "w2": pron("nә:s"), "w3": nil}
	for id, wantPron := range want {
		var w Word
		if err := DB.First(&w, "id = ?", id).Error; err != nil {
			t.Fatalf("read %s: %v", id, err)
		}
		switch {
		case wantPron == nil && w.Pronunciation != nil:
			t.Errorf("%s pronunciation = %q, want NULL", id, *w.Pronunciation)
		case wantPron != nil && (w.Pronunciation == nil || *w.Pronunciation != *wantPron):
			t.Errorf("%s pronunciation = %v, want %q", id, w.Pronunciation, *wantPron)
		}
		if w.UpdatedAt != 1 {
			t.Errorf("%s updated_at = %d, want it untouched", id, w.UpdatedAt)
		}
	}
}

// Only debug traces every statement; production (info) keeps slow queries
// and errors.
func TestSQLLogLevel(t *testing.T) {
	cases := map[string]logger.LogLevel{
		"debug": logger.Info,
		"Debug": logger.Info,
		"info":  logger.Warn,
		"error": logger.Warn,
		"":      logger.Warn,
	}
	for level, want := range cases {
		if got := SQLLogLevel(level); got != want {
			t.Errorf("SQLLogLevel(%q) = %v, want %v", level, got, want)
		}
	}
}

func TestInitRejectsBillingMigrationsBeforeWriting(t *testing.T) {
	for _, version := range []string{WebhookReceiptsVersion, SubscriptionOwnershipVersion, CreditProvenanceVersion, DeletionGatesVersion} {
		t.Run(version, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "migrated.db")
			db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(schemaMigrationsDDL).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("INSERT INTO schema_migrations VALUES (?, 1)", version).Error; err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			if err := sqlDB.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := InitWithLogLevel(path, "error"); err == nil {
				t.Fatal("expected migrated database to be rejected")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(before) != string(after) {
				t.Fatal("database changed during rejected startup")
			}
		})
	}
}
