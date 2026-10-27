package sqlitex

import "gorm.io/gorm"

var billingMigrationVersions = []string{WebhookReceiptsVersion, SubscriptionOwnershipVersion, CreditProvenanceVersion, DeletionGatesVersion}

// MigrateBillingCutover applies the migrations in the deployment order specified
// by ADR-067 §部署边界 and #297 §Existing-data migration.
// Each migration records its own completion and can be safely retried.
func MigrateBillingCutover(db *gorm.DB) error {
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
	return nil
}
