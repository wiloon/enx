package sqlitex

import (
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func webhookReceiptTables(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var names []string
	if err := db.Raw("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'stripe_webhook_%' ORDER BY name").Scan(&names).Error; err != nil {
		t.Fatalf("read tables: %v", err)
	}
	return names
}

func webhookReceiptsMarked(t *testing.T, db *gorm.DB) bool {
	t.Helper()
	done, err := webhookReceiptsApplied(db)
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}
	return done
}

func TestWebhookReceiptsMigrationCreatesTheReceiptTablesAndRecordsItself(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")

	applied, err := MigrateWebhookReceipts(db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !applied {
		t.Fatal("applied = false, want the first run to apply the migration")
	}
	if got := strings.Join(webhookReceiptTables(t, db), ","); got != "stripe_webhook_deliveries,stripe_webhook_events" {
		t.Fatalf("tables = %s, want stripe_webhook_deliveries,stripe_webhook_events", got)
	}
	if !webhookReceiptsMarked(t, db) {
		t.Fatalf("schema_migrations has no %s", WebhookReceiptsVersion)
	}
}

func TestWebhookReceiptsMigrationRunsOnlyOnce(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
	if _, err := MigrateWebhookReceipts(db); err != nil {
		t.Fatalf("first run: %v", err)
	}

	applied, err := MigrateWebhookReceipts(db)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if applied {
		t.Fatal("applied = true on the second run, want it to see the marker and do nothing")
	}
}

func TestWebhookReceiptsMigrationSharesTheMarkerTableWithTheOwnershipMigration(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")
	if _, err := MigrateSubscriptionOwnership(db); err != nil {
		t.Fatalf("ownership migration: %v", err)
	}

	if _, err := MigrateWebhookReceipts(db); err != nil {
		t.Fatalf("migrate after the ownership migration: %v", err)
	}
	var versions []string
	if err := db.Raw("SELECT version FROM schema_migrations ORDER BY version").Scan(&versions).Error; err != nil {
		t.Fatalf("read schema_migrations: %v", err)
	}
	if got := strings.Join(versions, ","); got != SubscriptionOwnershipVersion+","+WebhookReceiptsVersion {
		t.Fatalf("schema_migrations = %s, want both migrations", got)
	}
}

func TestAFailedWebhookReceiptsMigrationLeavesNothingBehind(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
	// A stray table of the same name makes the second CREATE fail.
	execAll(t, db, "CREATE TABLE `stripe_webhook_events` (`x` text)")

	if _, err := MigrateWebhookReceipts(db); err == nil {
		t.Fatal("migrate succeeded over a stray stripe_webhook_events table, want an error")
	}
	if got := strings.Join(webhookReceiptTables(t, db), ","); got != "stripe_webhook_events" {
		t.Fatalf("tables after the failure = %s, want only the stray stripe_webhook_events", got)
	}
	if webhookReceiptsMarked(t, db) {
		t.Fatal("a failed migration recorded its marker")
	}
}
