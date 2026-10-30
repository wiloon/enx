package sqlitex

import "gorm.io/gorm"

var billingMigrationVersions = []string{WebhookReceiptsVersion, SubscriptionOwnershipVersion, CreditProvenanceVersion, DeletionGatesVersion, DeletionAttemptsVersion}

// BillingMigrationVersions returns the startup migration order as an independent slice.
func BillingMigrationVersions() []string {
	return append([]string(nil), billingMigrationVersions...)
}

// InitializeBillingSchema creates the current billing structure on a fresh database.
// It never copies or converts legacy billing data. Persisted version values are
// retained so already initialized HomeLab databases can reopen unchanged.
func InitializeBillingSchema(db *gorm.DB) error {
	if _, err := MigrateWebhookReceipts(db); err != nil {
		return err
	}
	if _, err := MigrateSubscriptionOwnership(db); err != nil {
		return err
	}
	if _, err := MigrateCreditProvenance(db); err != nil {
		return err
	}
	if _, err := MigrateDeletionGates(db); err != nil {
		return err
	}
	return MigrateDeletionAttempts(db)
}
