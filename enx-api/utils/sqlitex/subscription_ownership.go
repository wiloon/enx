package sqlitex

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

const SubscriptionOwnershipVersion = "297-subscription-ownership-v1"

type SubscriptionOwnershipResult struct{ Applied bool }

// MigrateSubscriptionOwnership initializes the current billing schema only.
// Legacy user-keyed databases must be exported and replaced before deployment.
func MigrateSubscriptionOwnership(db *gorm.DB) (SubscriptionOwnershipResult, error) {
	var applied bool
	err := db.Transaction(func(tx *gorm.DB) error {
		done, err := migrationApplied(tx, SubscriptionOwnershipVersion)
		if err != nil || done {
			return err
		}
		if tx.Migrator().HasTable("subscriptions") {
			return fmt.Errorf("unsupported billing schema: initialize a fresh database")
		}
		if err := execEach(tx, schemaMigrationsDDL,
			"CREATE TABLE `stripe_customers` (`stripe_customer_id` text NOT NULL,`user_id` text NOT NULL,`created_at` integer NOT NULL,PRIMARY KEY (`stripe_customer_id`))",
			"CREATE INDEX `idx_stripe_customers_user_id` ON `stripe_customers`(`user_id`)",
			subscriptionsByIDDDL,
			"ALTER TABLE `subscriptions_by_id` RENAME TO `subscriptions`",
			"CREATE INDEX `idx_subscriptions_user_id` ON `subscriptions`(`user_id`)",
			"CREATE INDEX `idx_subscriptions_stripe_customer_id` ON `subscriptions`(`stripe_customer_id`)",
			"ALTER TABLE `users` ADD COLUMN `accepted_subscription_id` text",
			"ALTER TABLE `users` ADD COLUMN `billing_version` integer NOT NULL DEFAULT 0",
		); err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", SubscriptionOwnershipVersion, time.Now().UnixMilli()).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	return SubscriptionOwnershipResult{Applied: applied}, err
}
func migrationApplied(db *gorm.DB, version string) (bool, error) {
	var tables int64
	if err := db.Raw("SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").Scan(&tables).Error; err != nil {
		return false, fmt.Errorf("read schema_migrations: %w", err)
	}
	if tables == 0 {
		return false, nil
	}
	var marks int64
	if err := db.Raw("SELECT count(*) FROM `schema_migrations` WHERE `version` = ?", version).Scan(&marks).Error; err != nil {
		return false, fmt.Errorf("read schema_migrations: %w", err)
	}
	return marks > 0, nil
}

var subscriptionsByIDDDL = "CREATE TABLE `subscriptions_by_id` (" +
	"`stripe_subscription_id` text NOT NULL," +
	"`user_id` text," +
	"`stripe_customer_id` text NOT NULL," +
	"`status` text NOT NULL," +
	"`plan` text NOT NULL DEFAULT ''," +
	"`price_id` text NOT NULL DEFAULT ''," +
	"`current_period_end` integer," +
	"`cancel_at_period_end` integer NOT NULL DEFAULT 0," +
	"`cancel_at` integer NOT NULL DEFAULT 0," +
	"`pending_update` integer NOT NULL DEFAULT 0," +
	"`has_schedule` integer NOT NULL DEFAULT 0," +
	"`classification` text NOT NULL DEFAULT ''," +
	"`version` integer NOT NULL DEFAULT 1," +
	"`conflict_reason` text NOT NULL DEFAULT ''," +
	"`conflict_with_subscription_id` text NOT NULL DEFAULT ''," +
	"`conflict_discovered_at` integer," +
	"`conflict_status` text NOT NULL DEFAULT ''," +
	"`conflict_resolver_id` text NOT NULL DEFAULT ''," +
	"`conflict_resolved_at` integer," +
	"`conflict_notes` text NOT NULL DEFAULT ''," +
	"`support_message` text NOT NULL DEFAULT ''," +
	"`support_at` integer," +
	alertColumnsDDL("conflict_alert") + "," +
	alertColumnsDDL("support_alert") + "," +
	"`created_at` integer NOT NULL," +
	"`updated_at` integer NOT NULL," +
	"PRIMARY KEY (`stripe_subscription_id`))"

// alertColumnsDDL is one durable admin alert's delivery state.
func alertColumnsDDL(prefix string) string {
	return fmt.Sprintf("`%[1]s_state` text NOT NULL DEFAULT '',"+
		"`%[1]s_attempts` integer NOT NULL DEFAULT 0,"+
		"`%[1]s_last_error` text NOT NULL DEFAULT '',"+
		"`%[1]s_next_attempt_at` integer,"+
		"`%[1]s_sent_at` integer,"+
		"`%[1]s_claim_token` text NOT NULL DEFAULT '',"+
		"`%[1]s_claim_expires_at` integer", prefix)
}

// schemaMigrationsDDL is the marker table every versioned migration records
// itself in.
const schemaMigrationsDDL = "CREATE TABLE IF NOT EXISTS `schema_migrations` (`version` text NOT NULL,`applied_at` integer NOT NULL,PRIMARY KEY (`version`))"

func execEach(tx *gorm.DB, stmts ...string) error {
	for _, s := range stmts {
		if err := tx.Exec(s).Error; err != nil {
			return fmt.Errorf("%s: %w", s, err)
		}
	}
	return nil
}
