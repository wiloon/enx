package main

import (
	"path/filepath"
	"reflect"
	"testing"

	"enx-api/utils/sqlitex"
)

func TestBillingDatabaseStartupAppliesMigrationsWhenEnabled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "billing.db")
	if err := initializeBillingDatabase(path, "error", true); err != nil {
		t.Fatal(err)
	}
	var versions []string
	if err := sqlitex.DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	want := []string{sqlitex.WebhookReceiptsVersion, sqlitex.SubscriptionOwnershipVersion, sqlitex.CreditProvenanceVersion, sqlitex.DeletionGatesVersion}
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}
}

func TestBillingDatabaseStartupLeavesLegacySchemaWhenDisabled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "billing.db")
	if err := initializeBillingDatabase(path, "error", false); err != nil {
		t.Fatal(err)
	}
	if sqlitex.DB.Migrator().HasTable("schema_migrations") {
		t.Fatal("disabled startup applied billing migrations")
	}
}

func TestBillingDatabaseStartupMigratesLegacyFixture(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	if err := sqlitex.InitWithLogLevel(path, "error"); err != nil {
		t.Fatal(err)
	}
	for _, statement := range sqlStatements(t, "subscribed.sql") {
		if err := sqlitex.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := initializeBillingDatabase(path, "error", true); err != nil {
		t.Fatal(err)
	}
	var versions []string
	if err := sqlitex.DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	want := []string{sqlitex.WebhookReceiptsVersion, sqlitex.SubscriptionOwnershipVersion, sqlitex.CreditProvenanceVersion, sqlitex.DeletionGatesVersion}
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}
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
