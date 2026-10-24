package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// WebhookReceipts is webhookevent.ReceiptStore over stripe_webhook_deliveries
// and stripe_webhook_events (ADR-067), the tables
// sqlitex.MigrateWebhookReceipts creates.
type WebhookReceipts struct{}

var _ webhookevent.ReceiptStore = WebhookReceipts{}

// Record appends the delivery and, in the same transaction, inserts the
// task of its scoped event unless the event already has one.
func (WebhookReceipts) Record(ctx context.Context, d webhookevent.Delivery, task webhookevent.Task) error {
	env, scope, refs := d.Receipt.Envelope, d.Receipt.Scope, d.Receipt.Refs
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("INSERT INTO `stripe_webhook_deliveries` "+
			"(`id`, `received_at`, `stripe_account_id`, `livemode`, `event_id`, `event_type`, `event_created`, `api_version`, `payload`) "+
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			d.ID, d.ReceivedAt.UnixMilli(), scope.AccountID, scope.Livemode, scope.EventID,
			env.Type, env.Created, env.APIVersion, d.Payload).Error; err != nil {
			return fmt.Errorf("record webhook delivery: %w", err)
		}
		if err := tx.Exec("INSERT INTO `stripe_webhook_events` "+
			"(`stripe_account_id`, `livemode`, `event_id`, `type`, `created`, `api_version`, `first_delivery_id`, `first_received_at`, "+
			"`subscription_id`, `customer_id`, `checkout_session_id`, `invoice_id`, `payment_intent_id`, `charge_id`, "+
			"`status`, `attempts`, `last_error`, `first_wait_at`, `next_attempt_at`, `completed_at`, `claim_token`, `claim_expires_at`, `updated_at`) "+
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "+
			"ON CONFLICT (`stripe_account_id`, `livemode`, `event_id`) DO NOTHING",
			scope.AccountID, scope.Livemode, scope.EventID, task.Type, env.Created, env.APIVersion, d.ID, d.ReceivedAt.UnixMilli(),
			refs.SubscriptionID, refs.CustomerID, refs.CheckoutSessionID, refs.InvoiceID, refs.PaymentIntentID, refs.ChargeID,
			string(task.Status), task.Attempts, task.LastError, unixMilliOrNil(task.FirstWaitAt), unixMilliOrNil(task.NextAttemptAt),
			unixMilliOrNil(task.CompletedAt), task.ClaimToken, unixMilliOrNil(task.ClaimExpiresAt), d.ReceivedAt.UnixMilli()).Error; err != nil {
			return fmt.Errorf("record webhook event task: %w", err)
		}
		return nil
	})
}

// unixMilliOrNil stores a zero time as NULL.
func unixMilliOrNil(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UnixMilli()
}
