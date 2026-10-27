package main

import (
	"path/filepath"
	"reflect"
	"testing"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func TestBillingDatabaseStartupAppliesMigrationsWhenEnabled(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "billing.db")
	previous := sqlitex.DB
	err := initializeBillingDatabase(path, "error", true)
	closeNewBillingDatabase(t, previous)
	if err != nil {
		t.Fatal(err)
	}
	assertBillingMigrationOrder(t)
}

func TestBillingDatabaseStartupLeavesLegacySchemaWhenDisabled(t *testing.T) {
	restoreBillingDatabase(t)
	path := filepath.Join(t.TempDir(), "billing.db")
	previous := sqlitex.DB
	err := initializeBillingDatabase(path, "error", false)
	closeNewBillingDatabase(t, previous)
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
	previous := sqlitex.DB
	err := sqlitex.InitWithLogLevel(path, "error")
	closeNewBillingDatabase(t, previous)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range sqlStatements(t, "subscribed.sql") {
		if err := sqlitex.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	previous = sqlitex.DB
	err = initializeBillingDatabase(path, "error", true)
	closeNewBillingDatabase(t, previous)
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
	want := []string{sqlitex.WebhookReceiptsVersion, sqlitex.SubscriptionOwnershipVersion, sqlitex.CreditProvenanceVersion, sqlitex.DeletionGatesVersion}
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}

}
