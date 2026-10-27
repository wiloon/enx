package sqlitex

import "gorm.io/gorm"

// MigrateBillingCutover applies the ADR-067 migrations in deployment order.
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
