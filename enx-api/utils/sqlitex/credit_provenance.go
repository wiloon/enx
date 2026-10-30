package sqlitex

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ADR-067: subscription grants and pools retain invoice and period provenance.
// Fresh schema initialization adds these columns and indexes without reading
// or copying old billing data. Existing supported databases keep their markers.

// CreditProvenanceVersion names the migration in schema_migrations.
const CreditProvenanceVersion = "297-credit-provenance-v1"

// MigrateCreditProvenance adds the provenance columns. It returns false,
// changing nothing, once schema_migrations records it; any failure leaves
// the database as it was.
func MigrateCreditProvenance(db *gorm.DB) (bool, error) {
	applied := false
	err := db.Connection(func(conn *gorm.DB) error {
		return conn.Transaction(func(tx *gorm.DB) error {
			done, err := migrationApplied(tx, CreditProvenanceVersion)
			if err != nil || done {
				return err
			}
			if err := execEach(tx,
				schemaMigrationsDDL,
				// A subscription grant's provenance. grant_kind is
				// normal_period or upgrade_top_up; purchased is what the
				// invoice bought and applied what reached the pool (both
				// NULL on historical rows).
				// without_period retains incomplete historical provenance for audit.
				"ALTER TABLE `credit_transactions` ADD COLUMN `grant_kind` text NOT NULL DEFAULT ''",
				"ALTER TABLE `credit_transactions` ADD COLUMN `stripe_invoice_id` text",
				"ALTER TABLE `credit_transactions` ADD COLUMN `stripe_subscription_id` text",
				"ALTER TABLE `credit_transactions` ADD COLUMN `period_start` integer",
				"ALTER TABLE `credit_transactions` ADD COLUMN `period_end` integer",
				"ALTER TABLE `credit_transactions` ADD COLUMN `from_tier` text NOT NULL DEFAULT ''",
				"ALTER TABLE `credit_transactions` ADD COLUMN `tier` text NOT NULL DEFAULT ''",
				"ALTER TABLE `credit_transactions` ADD COLUMN `purchased` integer",
				"ALTER TABLE `credit_transactions` ADD COLUMN `applied` integer",
				"ALTER TABLE `credit_transactions` ADD COLUMN `without_period` integer NOT NULL DEFAULT 0",
				"ALTER TABLE `credit_transactions` ADD COLUMN `provenance_reason` text NOT NULL DEFAULT ''",
				// One subscription billing effect per invoice, whatever
				// Event ID delivers it.
				subscriptionInvoiceIndexDDL,
				"CREATE INDEX `idx_credit_transactions_subscription_period` ON `credit_transactions`(`stripe_subscription_id`, `period_end`)",
				"ALTER TABLE `credit_accounts` ADD COLUMN `pool_grant_id` text",
			); err != nil {
				return err
			}
			if err := tx.Exec("INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (?, ?)",
				CreditProvenanceVersion, time.Now().UnixMilli()).Error; err != nil {
				return fmt.Errorf("record completion: %w", err)
			}
			applied = true
			return nil
		})
	})
	if err != nil {
		return false, fmt.Errorf("credit provenance migration: %w (nothing was changed)", err)
	}
	return applied, nil
}

const subscriptionInvoiceIndexDDL = "CREATE UNIQUE INDEX `idx_credit_transactions_subscription_invoice` ON `credit_transactions`(`stripe_invoice_id`) WHERE `type` = 'GRANT_SUBSCRIPTION' AND `stripe_invoice_id` IS NOT NULL"
