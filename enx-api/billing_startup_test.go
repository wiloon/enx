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
