package sqlitex

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestBillingMigrationVersionsMatchRecordedOrder(t *testing.T) {
	Init(filepath.Join(t.TempDir(), "billing.db"))
	if err := MigrateBillingCutover(DB); err != nil {
		t.Fatal(err)
	}
	var versions []string
	if err := DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(versions, billingMigrationVersions) {
		t.Fatalf("recorded migration order = %v, billingMigrationVersions = %v", versions, billingMigrationVersions)
	}
}

func TestMigrateBillingCutoverAppliesMigrationsInOrderAndIsIdempotent(t *testing.T) {
	Init(filepath.Join(t.TempDir(), "billing.db"))
	if err := MigrateBillingCutover(DB); err != nil {
		t.Fatal(err)
	}
	var versions []string
	if err := DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	want := []string{WebhookReceiptsVersion, SubscriptionOwnershipVersion, CreditProvenanceVersion, DeletionGatesVersion}
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}
	if err := MigrateBillingCutover(DB); err != nil {
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

func TestMigrateBillingCutoverStopsOnMigrationFailure(t *testing.T) {
	Init(filepath.Join(t.TempDir(), "billing.db"))
	if err := DB.Exec("DROP TABLE subscriptions").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateBillingCutover(DB); err == nil {
		t.Fatal("expected subscription migration to fail")
	}
	var versions []string
	if err := DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(versions, []string{WebhookReceiptsVersion}) {
		t.Fatalf("migrations after failure = %v", versions)
	}
}
