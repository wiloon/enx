package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestBillingDatabaseStartupInitializesCurrentSchema(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "billing.db")
	err := openBillingDatabase(t, func() error { return initializeBillingDatabase(path, "error") })
	if err != nil {
		t.Fatal(err)
	}
	assertBillingMigrationOrder(t)
}

func restoreBillingDatabase(t *testing.T) {
	t.Helper()
	previous := sqlitex.DB
	t.Cleanup(func() { sqlitex.DB = previous })
}

func openBillingDatabase(t *testing.T, open func() error) error {
	t.Helper()
	previous := sqlitex.DB
	err := open()
	closeNewBillingDatabase(t, previous)
	return err
}

func closeNewBillingDatabase(t *testing.T, previous *gorm.DB) {
	t.Helper()
	db := sqlitex.DB
	if db == nil || db == previous {
		return
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err != nil {
			t.Errorf("get underlying database: %v", err)
			return
		}
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})
}

func assertBillingMigrationOrder(t *testing.T) {
	t.Helper()
	var versions []string
	if err := sqlitex.DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	want := sqlitex.BillingMigrationVersions()
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}
}

func seedLegacyStartupDatabase(t *testing.T, path string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := sqlDB.Close(); err != nil {
			t.Error(err)
		}
	}()
	for _, fixture := range []string{"schema.sql", "subscribed.sql"} {
		for _, statement := range sqlStatements(t, fixture) {
			if err := db.Exec(statement).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestBillingStartupRejectsLegacyDatabaseBeforeChangingIt(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "legacy.db")
	seedLegacyStartupDatabase(t, path)
	err := openBillingDatabase(t, func() error { return initializeBillingDatabase(path, "error") })
	if err == nil || !strings.Contains(err.Error(), "unsupported billing schema") {
		t.Fatalf("legacy startup = %v, want unsupported billing schema", err)
	}
	db, openErr := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if openErr != nil {
		t.Fatal(openErr)
	}
	raw, _ := db.DB()
	defer raw.Close()
	if db.Migrator().HasTable("schema_migrations") {
		t.Fatal("rejected database was migrated")
	}
	var balance int64
	if err := db.Raw("SELECT topup_balance FROM credit_accounts WHERE user_id = 'u_subscribed'").Scan(&balance).Error; err != nil {
		t.Fatal(err)
	}
	if balance != 0 {
		t.Fatalf("preserved balance = %d, want 0", balance)
	}
}

func TestBillingStartupRejectsAnUnknownSchemaVersionBeforeWrites(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "billing.db")
	if err := initializeBillingDatabase(path, "error"); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO schema_migrations VALUES ('future-billing-version', 1)").Error; err != nil {
		t.Fatal(err)
	}
	closeCurrentStartupDatabaseForSchemaTest(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	err = initializeBillingDatabase(path, "error")
	if err == nil || !strings.Contains(err.Error(), "unsupported billing schema") {
		t.Fatalf("future schema startup = %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("unsupported schema was modified")
	}
}
func closeCurrentStartupDatabaseForSchemaTest(t *testing.T) {
	t.Helper()
	db, err := sqlitex.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}
