package sqlitex

import (
	"fmt"
	"strings"
	"time"

	zapLog "enx-api/utils/logger"

	"gorm.io/gorm"
)

// ADR-067 §一次性充值与 Stripe Customer and #297 §Existing-data migration:
// the user-keyed subscriptions table becomes one row per Stripe Subscription
// ID, every Customer ownership moves to stripe_customers, and each users row
// gets a nullable accepted_subscription_id. Changing a primary key is not an
// AutoMigrate operation, so MigrateSubscriptionOwnership is an explicit,
// versioned migration that runs in one transaction and records its
// completion in schema_migrations.

// SubscriptionOwnershipVersion names the migration in schema_migrations.
const SubscriptionOwnershipVersion = "297-subscription-ownership-v1"

const subscriptionOwnershipBackupSuffix = ".pre-subscription-ownership-"

// SubscriptionOwnershipResult is what MigrateSubscriptionOwnership did.
type SubscriptionOwnershipResult struct {
	// Applied is false when schema_migrations shows an earlier run; nothing
	// was read or written then.
	Applied bool
	// Backup is the VACUUM INTO copy written before the migration; keep it
	// until the release is verified. Empty when nothing ran.
	Backup string
	// Customers, Subscriptions and AcceptedPointers count the stripe_customers
	// rows, migrated subscriptions and users given an accepted subscription.
	Customers        int64
	Subscriptions    int64
	AcceptedPointers int64
}

// subscriptionOwnership holds what the migration needs besides the
// database: the clock for the completion marker, and a hook tests use to
// fail after a step.
type subscriptionOwnership struct {
	now       func() time.Time
	afterStep func(step string, tx *gorm.DB) error
}

// MigrateSubscriptionOwnership moves the legacy billing data to the
// Subscription-ID-keyed schema. It does nothing once schema_migrations
// records it. Otherwise a preflight lists every legacy row it would have to
// guess about and stops, writing nothing; then it backs the database up and
// migrates in one transaction, so any failure leaves the legacy data as it
// was. Customer-only (top-up) rows create no subscription, each real
// subscription stays accepted, and credit balances and the ledger are not
// touched.
func MigrateSubscriptionOwnership(db *gorm.DB) (SubscriptionOwnershipResult, error) {
	return subscriptionOwnership{now: time.Now}.run(db)
}

func (m subscriptionOwnership) run(db *gorm.DB) (SubscriptionOwnershipResult, error) {
	done, err := subscriptionOwnershipApplied(db)
	if err != nil {
		return SubscriptionOwnershipResult{}, fmt.Errorf("subscription ownership migration: %w", err)
	}
	if done {
		return SubscriptionOwnershipResult{}, nil
	}
	if err := preflightSubscriptionOwnership(db); err != nil {
		return SubscriptionOwnershipResult{}, fmt.Errorf("subscription ownership migration: %w", err)
	}

	backup, err := backupDatabase(db, subscriptionOwnershipBackupSuffix, m.now())
	if err != nil {
		return SubscriptionOwnershipResult{}, fmt.Errorf("subscription ownership migration: backup failed, nothing was changed: %w", err)
	}
	zapLog.Warnf("subscription ownership migration: backup written to %s (keep it until the release is verified)", backup)

	res := SubscriptionOwnershipResult{Backup: backup}
	err = db.Connection(func(conn *gorm.DB) error {
		return conn.Transaction(func(tx *gorm.DB) error {
			// Checked again inside the transaction, in case another process
			// migrated since.
			done, err := subscriptionOwnershipApplied(tx)
			if err != nil || done {
				return err
			}
			if err := preflightSubscriptionOwnership(tx); err != nil {
				return err
			}
			res, err = m.migrate(tx)
			res.Backup = backup
			return err
		})
	})
	if err != nil {
		return SubscriptionOwnershipResult{Backup: backup}, fmt.Errorf("subscription ownership migration: %w (nothing was changed; backup at %s)", err, backup)
	}
	if res.Applied {
		zapLog.Infof("subscription ownership migration: done; %d Customers, %d subscriptions, %d accepted pointers",
			res.Customers, res.Subscriptions, res.AcceptedPointers)
	}
	return res, nil
}

// subscriptionOwnershipApplied reports whether schema_migrations records the
// migration.
func subscriptionOwnershipApplied(db *gorm.DB) (bool, error) {
	var tables int64
	if err := db.Raw("SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").Scan(&tables).Error; err != nil {
		return false, fmt.Errorf("read schema_migrations: %w", err)
	}
	if tables == 0 {
		return false, nil
	}
	var marks int64
	if err := db.Raw("SELECT count(*) FROM `schema_migrations` WHERE `version` = ?", SubscriptionOwnershipVersion).Scan(&marks).Error; err != nil {
		return false, fmt.Errorf("read schema_migrations: %w", err)
	}
	return marks > 0, nil
}

// subscriptionTiers are the plans a migrated subscription may carry.
var subscriptionTiers = []string{"pro", "pro-plus", "max"}

// preflightSubscriptionOwnership reads the legacy rows and lists every one
// the migration would have to guess about. It writes nothing; an operator
// fixes the rows by hand and runs the migration again.
func preflightSubscriptionOwnership(tx *gorm.DB) error {
	if err := checkLegacyBillingSchema(tx); err != nil {
		return fmt.Errorf("preflight: %w", err)
	}
	checks := []struct {
		query  string
		args   []any
		format string // gets the two selected columns
	}{
		{
			query:  "SELECT COALESCE(`stripe_customer_id`, ''), '' FROM `subscriptions` WHERE `user_id` IS NULL OR trim(`user_id`) = ''",
			format: "Customer %q: no owning user%.0s",
		},
		{
			query:  "SELECT `user_id`, '' FROM `subscriptions` WHERE `stripe_customer_id` IS NULL OR trim(`stripe_customer_id`) = ''",
			format: "user %q: blank Stripe Customer ID%.0s",
		},
		{
			query:  "SELECT `user_id`, '' FROM `subscriptions` WHERE `stripe_subscription_id` IS NOT NULL AND trim(`stripe_subscription_id`) = ''",
			format: "user %q: blank Stripe Subscription ID%.0s",
		},
		{
			query:  "SELECT `user_id`, `status` FROM `subscriptions` WHERE `stripe_subscription_id` IS NULL AND `status` != 'none'",
			format: "user %q: status %q but no Stripe Subscription ID",
		},
		{
			query: "SELECT `stripe_subscription_id`, COALESCE(`plan`, '') FROM `subscriptions` " +
				"WHERE trim(COALESCE(`stripe_subscription_id`, '')) != '' AND COALESCE(`plan`, '') NOT IN ?",
			args:   []any{subscriptionTiers},
			format: "subscription %q: plan %q is not a current tier",
		},
		{
			query: "SELECT `stripe_subscription_id`, '' FROM `subscriptions` WHERE trim(COALESCE(`stripe_subscription_id`, '')) != '' " +
				"GROUP BY `stripe_subscription_id` HAVING count(*) > 1",
			format: "subscription %q: on more than one row%.0s",
		},
		{
			query: "SELECT `stripe_customer_id`, '' FROM `subscriptions` WHERE trim(COALESCE(`stripe_customer_id`, '')) != '' " +
				"GROUP BY `stripe_customer_id` HAVING count(*) > 1",
			format: "Customer %q: on more than one row%.0s",
		},
		{
			query: "SELECT DISTINCT t.`user_id`, '' FROM `credit_transactions` t WHERE t.`type` = 'GRANT_SUBSCRIPTION' AND NOT EXISTS " +
				"(SELECT 1 FROM `subscriptions` s WHERE s.`user_id` = t.`user_id` AND trim(COALESCE(s.`stripe_subscription_id`, '')) != '')",
			format: "user %q: GRANT_SUBSCRIPTION ledger rows but no subscription to attribute them to%.0s",
		},
	}
	var problems []string
	for _, c := range checks {
		found, err := scanPairs(tx, c.query, c.args...)
		if err != nil {
			return fmt.Errorf("preflight: %w", err)
		}
		for _, p := range found {
			problems = append(problems, fmt.Sprintf(c.format, p[0], p[1]))
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("preflight stopped on %d legacy row(s) it would have to guess about; nothing was changed: %s",
			len(problems), strings.Join(problems, "; "))
	}
	return nil
}

// checkLegacyBillingSchema refuses to start unless subscriptions is still
// keyed by user.
func checkLegacyBillingSchema(tx *gorm.DB) error {
	cols, err := tableColumns(tx, "subscriptions")
	if err != nil {
		return fmt.Errorf("read subscriptions columns: %w", err)
	}
	var pk []string
	for _, c := range cols {
		if c.Pk > 0 {
			pk = append(pk, strings.ToLower(c.Name))
		}
	}
	if len(pk) != 1 || pk[0] != "user_id" {
		return fmt.Errorf("subscriptions is not the legacy user-keyed table (primary key %v); fix the schema by hand before starting", pk)
	}
	return nil
}

// scanPairs runs a query selecting two text columns.
func scanPairs(tx *gorm.DB, query string, args ...any) ([][2]string, error) {
	rows, err := tx.Raw(query, args...).Rows()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out [][2]string
	for rows.Next() {
		var p [2]string
		if err := rows.Scan(&p[0], &p[1]); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// subscriptionsByIDDDL is the new subscriptions table: the Stripe snapshot,
// ENX's classification and its conflict investigation, the billing-support
// request, and the conflict and support alerts (ADR-067 §订阅归属与接受关系,
// §管理员处理与邮件). version changes on every write to the row.
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

// Steps afterStep hears about, in order.
const (
	ownershipStepCustomers     = "customers"     // stripe_customers holds every Customer
	ownershipStepSubscriptions = "subscriptions" // subscriptions is keyed by Subscription ID
	ownershipStepPointers      = "pointers"      // users point at their accepted subscription
)

func (m subscriptionOwnership) migrate(tx *gorm.DB) (SubscriptionOwnershipResult, error) {
	var legacyRows, legacySubscriptions int64
	if err := tx.Raw("SELECT count(*), count(`stripe_subscription_id`) FROM `subscriptions`").Row().Scan(&legacyRows, &legacySubscriptions); err != nil {
		return SubscriptionOwnershipResult{}, fmt.Errorf("count legacy subscriptions: %w", err)
	}
	res := SubscriptionOwnershipResult{Applied: true}

	if err := execEach(tx,
		"CREATE TABLE IF NOT EXISTS `schema_migrations` (`version` text NOT NULL,`applied_at` integer NOT NULL,PRIMARY KEY (`version`))",
		"CREATE TABLE `stripe_customers` (`stripe_customer_id` text NOT NULL,`user_id` text NOT NULL,`created_at` integer NOT NULL,PRIMARY KEY (`stripe_customer_id`))",
		"CREATE INDEX `idx_stripe_customers_user_id` ON `stripe_customers`(`user_id`)",
		"INSERT INTO `stripe_customers` (`stripe_customer_id`, `user_id`, `created_at`) SELECT `stripe_customer_id`, `user_id`, `created_at` FROM `subscriptions`",
	); err != nil {
		return res, err
	}
	if err := verifyCount(tx, "SELECT count(*) FROM `stripe_customers`", legacyRows, "stripe_customers", &res.Customers); err != nil {
		return res, err
	}
	if err := m.step(ownershipStepCustomers, tx); err != nil {
		return res, err
	}

	if err := execEach(tx,
		subscriptionsByIDDDL,
		"INSERT INTO `subscriptions_by_id` (`stripe_subscription_id`, `user_id`, `stripe_customer_id`, `status`, `plan`, `current_period_end`, `classification`, `created_at`, `updated_at`) "+
			"SELECT `stripe_subscription_id`, `user_id`, `stripe_customer_id`, `status`, COALESCE(`plan`, ''), `current_period_end`, 'accepted', `created_at`, `updated_at` "+
			"FROM `subscriptions` WHERE `stripe_subscription_id` IS NOT NULL",
		"DROP TABLE `subscriptions`",
		"ALTER TABLE `subscriptions_by_id` RENAME TO `subscriptions`",
		"CREATE INDEX `idx_subscriptions_user_id` ON `subscriptions`(`user_id`)",
		"CREATE INDEX `idx_subscriptions_stripe_customer_id` ON `subscriptions`(`stripe_customer_id`)",
	); err != nil {
		return res, err
	}
	if err := verifyCount(tx, "SELECT count(*) FROM `subscriptions`", legacySubscriptions, "subscriptions", &res.Subscriptions); err != nil {
		return res, err
	}
	if err := m.step(ownershipStepSubscriptions, tx); err != nil {
		return res, err
	}

	// Every legacy row was its user's accepted subscription, an ended one
	// included (it stays accepted history until a new one replaces it). A
	// deleted user has no users row, so no pointer is made for them.
	if err := execEach(tx,
		"ALTER TABLE `users` ADD COLUMN `accepted_subscription_id` text",
		"ALTER TABLE `users` ADD COLUMN `billing_version` integer NOT NULL DEFAULT 0",
		"UPDATE `users` SET `accepted_subscription_id` = (SELECT s.`stripe_subscription_id` FROM `subscriptions` s WHERE s.`user_id` = `users`.`id`)",
	); err != nil {
		return res, err
	}
	var owned int64
	if err := tx.Raw("SELECT count(*) FROM `subscriptions` s JOIN `users` u ON u.`id` = s.`user_id`").Scan(&owned).Error; err != nil {
		return res, fmt.Errorf("verify: %w", err)
	}
	if err := verifyCount(tx, "SELECT count(*) FROM `users` WHERE `accepted_subscription_id` IS NOT NULL", owned, "accepted pointers", &res.AcceptedPointers); err != nil {
		return res, err
	}
	if err := m.step(ownershipStepPointers, tx); err != nil {
		return res, err
	}

	if err := tx.Exec("INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (?, ?)",
		SubscriptionOwnershipVersion, m.now().UnixMilli()).Error; err != nil {
		return res, fmt.Errorf("record completion: %w", err)
	}
	return res, nil
}

func execEach(tx *gorm.DB, stmts ...string) error {
	for _, s := range stmts {
		if err := tx.Exec(s).Error; err != nil {
			return fmt.Errorf("%s: %w", s, err)
		}
	}
	return nil
}

// verifyCount checks that query counts want rows, and stores the count.
func verifyCount(tx *gorm.DB, query string, want int64, what string, got *int64) error {
	if err := tx.Raw(query).Scan(got).Error; err != nil {
		return fmt.Errorf("verify %s: %w", what, err)
	}
	if *got != want {
		return fmt.Errorf("verify: %d %s after the migration, want %d", *got, what, want)
	}
	return nil
}

func (m subscriptionOwnership) step(name string, tx *gorm.DB) error {
	if m.afterStep == nil {
		return nil
	}
	return m.afterStep(name, tx)
}
