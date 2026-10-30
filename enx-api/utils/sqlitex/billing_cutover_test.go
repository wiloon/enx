package sqlitex

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestBillingMigrationVersionsReturnsIndependentStartupOrder(t *testing.T) {
	versions := BillingMigrationVersions()
	if !reflect.DeepEqual(versions, billingMigrationVersions) {
		t.Fatalf("versions = %v, want startup order %v", versions, billingMigrationVersions)
	}
	if len(versions) == 0 {
		t.Fatal("startup migration order is empty")
	}
	original := billingMigrationVersions[0]
	versions[0] = "changed"
	if billingMigrationVersions[0] != original {
		t.Fatal("changing returned versions changed startup order")
	}
}

func TestInitializeBillingSchemaAppliesMigrationsInOrderAndIsIdempotent(t *testing.T) {
	Init(filepath.Join(t.TempDir(), "billing.db"))
	if err := InitializeBillingSchema(DB); err != nil {
		t.Fatal(err)
	}
	var versions []string
	if err := DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	want := billingMigrationVersions
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}
	if err := InitializeBillingSchema(DB); err != nil {
		t.Fatal(err)
	}
	var after []string
	if err := DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, want) {
		t.Fatalf("after restart = %v, want %v", after, want)
	}
}
