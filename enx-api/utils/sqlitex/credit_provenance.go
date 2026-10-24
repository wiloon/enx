package sqlitex

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ADR-067 §积分周期与退款来源 and #297 §Credit-period provenance: each
// subscription billing effect records the invoice, the real Subscription ID
// and billing period it belongs to, and credit_accounts records the grant
// that supplies subscription_balance. MigrateCreditProvenance adds those
// columns, all empty on legacy rows, and points each migrated pool at its
// legacy grant; the legacy provenance backfill (billing/legacyprovenance)
// fills that grant in from Stripe later. It changes no amount, balance or
// ledger row, runs in one transaction and records its completion in
// schema_migrations.

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
				// NULL on a legacy row, whose amount was both).
				// without_period marks a migrated grant the backfill could
				// not pin to one invoice, with provenance_reason saying why.
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
				"CREATE UNIQUE INDEX `idx_credit_transactions_subscription_invoice` ON `credit_transactions`(`stripe_invoice_id`) "+
					"WHERE `type` = 'GRANT_SUBSCRIPTION' AND `stripe_invoice_id` IS NOT NULL",
				"CREATE INDEX `idx_credit_transactions_subscription_period` ON `credit_transactions`(`stripe_subscription_id`, `period_end`)",
				"ALTER TABLE `credit_accounts` ADD COLUMN `pool_grant_id` text",
				// The legacy pool comes from the user's latest
				// GRANT_SUBSCRIPTION: every legacy renewal reset it, and
				// legacy refunds find the current period's grant this way.
				"UPDATE `credit_accounts` SET `pool_grant_id` = (SELECT t.`id` FROM `credit_transactions` t "+
					"WHERE t.`user_id` = `credit_accounts`.`user_id` AND t.`type` = 'GRANT_SUBSCRIPTION' "+
					"ORDER BY t.`created_at` DESC, t.rowid DESC LIMIT 1)",
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
