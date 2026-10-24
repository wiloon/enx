package sqlitex

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ADR-067 §持久接收与异步处理 and #297 §Data model: every verified Stripe
// webhook delivery is kept, with its complete original payload, in the
// append-only stripe_webhook_deliveries, and each scoped Stripe event gets
// one durable processing task in stripe_webhook_events. Both tables are new
// and touch no existing data, so MigrateWebhookReceipts needs no preflight
// or backup; it still runs in one transaction and records its completion in
// schema_migrations.

// WebhookReceiptsVersion names the migration in schema_migrations.
const WebhookReceiptsVersion = "297-webhook-receipts-v1"

// webhookDeliveriesDDL is one row per verified HTTP delivery. Repeated
// deliveries of one event are separate rows linked to the same event by its
// scope (stripe_account_id, livemode, event_id); there is no Event ID
// uniqueness here.
const webhookDeliveriesDDL = "CREATE TABLE `stripe_webhook_deliveries` (" +
	"`id` text NOT NULL," +
	"`received_at` integer NOT NULL," +
	"`stripe_account_id` text NOT NULL," +
	"`livemode` integer NOT NULL," +
	"`event_id` text NOT NULL," +
	"`event_type` text NOT NULL," +
	"`event_created` integer NOT NULL," +
	"`api_version` text NOT NULL DEFAULT ''," +
	"`payload` blob NOT NULL," +
	"PRIMARY KEY (`id`))"

// webhookEventsDDL is one processing task per scoped Stripe event: the
// event's first delivery, the Stripe objects it names (no ENX user: that
// stays unknown until attribution), the task state of
// webhookevent.Task with its claim, and its administrator alert.
var webhookEventsDDL = "CREATE TABLE `stripe_webhook_events` (" +
	"`stripe_account_id` text NOT NULL," +
	"`livemode` integer NOT NULL," +
	"`event_id` text NOT NULL," +
	"`type` text NOT NULL," +
	"`created` integer NOT NULL," +
	"`api_version` text NOT NULL DEFAULT ''," +
	"`first_delivery_id` text NOT NULL," +
	"`first_received_at` integer NOT NULL," +
	"`subscription_id` text NOT NULL DEFAULT ''," +
	"`customer_id` text NOT NULL DEFAULT ''," +
	"`checkout_session_id` text NOT NULL DEFAULT ''," +
	"`invoice_id` text NOT NULL DEFAULT ''," +
	"`payment_intent_id` text NOT NULL DEFAULT ''," +
	"`charge_id` text NOT NULL DEFAULT ''," +
	"`status` text NOT NULL," +
	"`attempts` integer NOT NULL DEFAULT 0," +
	"`last_error` text NOT NULL DEFAULT ''," +
	"`first_wait_at` integer," +
	"`next_attempt_at` integer," +
	"`completed_at` integer," +
	"`claim_token` text NOT NULL DEFAULT ''," +
	"`claim_expires_at` integer," +
	alertColumnsDDL("alert") + "," +
	"`updated_at` integer NOT NULL," +
	"PRIMARY KEY (`stripe_account_id`, `livemode`, `event_id`))"

// MigrateWebhookReceipts creates the webhook receipt tables. It returns
// false, changing nothing, once schema_migrations records it; any failure
// leaves the database as it was.
func MigrateWebhookReceipts(db *gorm.DB) (bool, error) {
	applied := false
	err := db.Connection(func(conn *gorm.DB) error {
		return conn.Transaction(func(tx *gorm.DB) error {
			done, err := webhookReceiptsApplied(tx)
			if err != nil || done {
				return err
			}
			if err := execEach(tx,
				schemaMigrationsDDL,
				webhookDeliveriesDDL,
				"CREATE INDEX `idx_stripe_webhook_deliveries_event` ON `stripe_webhook_deliveries`(`stripe_account_id`, `livemode`, `event_id`)",
				webhookEventsDDL,
				"CREATE INDEX `idx_stripe_webhook_events_status` ON `stripe_webhook_events`(`status`)",
				"CREATE INDEX `idx_stripe_webhook_events_subscription_id` ON `stripe_webhook_events`(`subscription_id`)",
				"CREATE INDEX `idx_stripe_webhook_events_customer_id` ON `stripe_webhook_events`(`customer_id`)",
				"CREATE INDEX `idx_stripe_webhook_events_checkout_session_id` ON `stripe_webhook_events`(`checkout_session_id`)",
				"CREATE INDEX `idx_stripe_webhook_events_invoice_id` ON `stripe_webhook_events`(`invoice_id`)",
				"CREATE INDEX `idx_stripe_webhook_events_payment_intent_id` ON `stripe_webhook_events`(`payment_intent_id`)",
				"CREATE INDEX `idx_stripe_webhook_events_charge_id` ON `stripe_webhook_events`(`charge_id`)",
			); err != nil {
				return err
			}
			if err := tx.Exec("INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (?, ?)",
				WebhookReceiptsVersion, time.Now().UnixMilli()).Error; err != nil {
				return fmt.Errorf("record completion: %w", err)
			}
			applied = true
			return nil
		})
	})
	if err != nil {
		return false, fmt.Errorf("webhook receipts migration: %w (nothing was changed)", err)
	}
	return applied, nil
}

// webhookReceiptsApplied reports whether schema_migrations records the
// migration.
func webhookReceiptsApplied(db *gorm.DB) (bool, error) {
	return migrationApplied(db, WebhookReceiptsVersion)
}
