package main

import (
	"path/filepath"
	"reflect"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestBillingDatabaseStartupAppliesMigrationsWhenEnabled(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "billing.db")
	err := openBillingDatabase(t, func() error { return initializeBillingDatabase(path, "error", true) })
	if err != nil {
		t.Fatal(err)
	}
	assertBillingMigrationOrder(t)
}

func TestBillingDatabaseStartupLeavesLegacySchemaWhenDisabled(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "billing.db")
	err := openBillingDatabase(t, func() error { return initializeBillingDatabase(path, "error", false) })
	if err != nil {
		t.Fatal(err)
	}
	if sqlitex.DB.Migrator().HasTable("schema_migrations") {
		t.Fatal("disabled startup applied billing migrations")
	}
}

func TestBillingDatabaseStartupMigratesLegacyFixture(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "legacy.db")
	seedLegacyStartupDatabase(t, path)
	err := openBillingDatabase(t, func() error { return initializeBillingDatabase(path, "error", true) })
	if err != nil {
		t.Fatal(err)
	}
	assertBillingMigrationOrder(t)
	var accepted string
	if err := sqlitex.DB.Raw("SELECT accepted_subscription_id FROM users WHERE id = ?", "u_subscribed").Scan(&accepted).Error; err != nil {
		t.Fatal(err)
	}
	if accepted != "sub_subscribed" {
		t.Fatalf("accepted subscription = %q", accepted)
	}
	var count int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM subscriptions WHERE stripe_subscription_id = ? AND stripe_customer_id = ?", "sub_subscribed", "cus_subscribed").Scan(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("migrated subscription count = %d, want 1", count)
	}
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
