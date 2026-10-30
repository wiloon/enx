package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/eventadmin"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// EffectApplier applies scope's handled event's webhookevent.Effects inside
// tx, the transaction that saves the event's task. An error rolls the task
// back with them.
type EffectApplier func(tx *gorm.DB, scope webhookevent.Scope, effects webhookevent.Effects) error

// WebhookEvents is webhookevent.TaskStore over the stripe_webhook_events
// rows WebhookReceipts creates (ADR-067).
type WebhookEvents struct {
	apply EffectApplier
}

var (
	_ webhookevent.TaskStore = WebhookEvents{}
	_ eventadmin.Store       = WebhookEvents{}
)

// NewWebhookEvents returns the store. apply applies the effects the
// worker's handler returns; nil means Save accepts no effects.
func NewWebhookEvents(apply EffectApplier) WebhookEvents {
	return WebhookEvents{apply: apply}
}

// webhookEventRow is a stripe_webhook_events row as webhookEventColumns
// reads it.
type webhookEventRow struct {
	StripeAccountID     string
	Livemode            bool
	EventID             string
	Type                string
	Created             int64
	APIVersion          string
	SubscriptionID      string
	CustomerID          string
	CheckoutSessionID   string
	InvoiceID           string
	PaymentIntentID     string
	ChargeID            string
	FirstDeliveryID     string
	Status              string
	Attempts            int
	LastError           string
	FirstWaitAt         *int64
	NextAttemptAt       *int64
	CompletedAt         *int64
	ClaimToken          string
	ClaimExpiresAt      *int64
	AlertState          string
	AlertAttempts       int
	AlertLastError      string
	AlertNextAttemptAt  *int64
	AlertSentAt         *int64
	AlertClaimToken     string
	AlertClaimExpiresAt *int64
}

const webhookEventColumns = "`stripe_account_id`, `livemode`, `event_id`, `type`, `created`, `api_version`, " +
	"`subscription_id`, `customer_id`, `checkout_session_id`, `invoice_id`, `payment_intent_id`, `charge_id`, `first_delivery_id`, " +
	"`status`, `attempts`, `last_error`, `first_wait_at`, `next_attempt_at`, `completed_at`, `claim_token`, `claim_expires_at`, " +
	"`alert_state`, `alert_attempts`, `alert_last_error`, `alert_next_attempt_at`, `alert_sent_at`, `alert_claim_token`, `alert_claim_expires_at`"

// Unfinished returns every pending, processing or waiting task, oldest
// receipt first.
func (WebhookEvents) Unfinished(ctx context.Context) ([]webhookevent.StoredTask, error) {
	var rows []webhookEventRow
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT "+webhookEventColumns+" "+
		"FROM `stripe_webhook_events` WHERE `status` IN (?, ?, ?) ORDER BY `first_received_at`, `event_id`",
		string(webhookevent.Pending), string(webhookevent.Processing), string(webhookevent.WaitingDependency)).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read unfinished webhook events: %w", err)
	}
	tasks := make([]webhookevent.StoredTask, 0, len(rows))
	for _, r := range rows {
		tasks = append(tasks, r.storedTask())
	}
	return tasks, nil
}

func (r webhookEventRow) storedTask() webhookevent.StoredTask {
	return webhookevent.StoredTask{
		Scope:      webhookevent.Scope{AccountID: r.StripeAccountID, Livemode: r.Livemode, EventID: r.EventID},
		APIVersion: r.APIVersion,
		Task: webhookevent.Task{
			Type:           r.Type,
			SubscriptionID: r.SubscriptionID,
			Status:         webhookevent.Status(r.Status),
			Attempts:       r.Attempts,
			LastError:      r.LastError,
			FirstWaitAt:    timeOrZero(r.FirstWaitAt),
			NextAttemptAt:  timeOrZero(r.NextAttemptAt),
			CompletedAt:    timeOrZero(r.CompletedAt),
			ClaimToken:     r.ClaimToken,
			ClaimExpiresAt: timeOrZero(r.ClaimExpiresAt),
			Alert: alert.Alert{
				State:          alert.State(r.AlertState),
				Attempts:       r.AlertAttempts,
				LastError:      r.AlertLastError,
				NextAttemptAt:  timeOrZero(r.AlertNextAttemptAt),
				SentAt:         timeOrZero(r.AlertSentAt),
				ClaimToken:     r.AlertClaimToken,
				ClaimExpiresAt: timeOrZero(r.AlertClaimExpiresAt),
			},
		},
	}
}

// ListEvents reads one page of endpoint's events in q.Status, newest
// receipt first, for eventadmin.Store.
func (WebhookEvents) ListEvents(ctx context.Context, endpoint webhookevent.Endpoint, q eventadmin.ListQuery) ([]eventadmin.Event, error) {
	var rows []webhookEventRow
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT "+webhookEventColumns+" FROM `stripe_webhook_events` "+
		"WHERE `stripe_account_id` = ? AND `livemode` = ? AND `status` = ? "+
		"ORDER BY `first_received_at` DESC, `event_id` DESC LIMIT ? OFFSET ?",
		endpoint.AccountID, endpoint.Livemode, string(q.Status), q.Limit, q.Offset).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list webhook events: %w", err)
	}
	events := make([]eventadmin.Event, 0, len(rows))
	for _, r := range rows {
		events = append(events, r.event())
	}
	return events, nil
}

// Event reads scope's event with every delivery, oldest first, and the
// original payload of its first delivery, for eventadmin.Store. An event
// ENX never received for that scope is eventadmin.ErrNotFound.
func (WebhookEvents) Event(ctx context.Context, scope webhookevent.Scope) (eventadmin.Detail, error) {
	db := sqlitex.DB.WithContext(ctx)
	var rows []webhookEventRow
	if err := db.Raw("SELECT "+webhookEventColumns+" FROM `stripe_webhook_events` "+
		"WHERE `stripe_account_id` = ? AND `livemode` = ? AND `event_id` = ?",
		scope.AccountID, scope.Livemode, scope.EventID).Scan(&rows).Error; err != nil {
		return eventadmin.Detail{}, fmt.Errorf("read webhook event: %w", err)
	}
	if len(rows) == 0 {
		return eventadmin.Detail{}, eventadmin.ErrNotFound
	}
	var deliveries []struct {
		ID         string
		ReceivedAt int64
		Payload    []byte
	}
	if err := db.Raw("SELECT `id`, `received_at`, `payload` FROM `stripe_webhook_deliveries` "+
		"WHERE `stripe_account_id` = ? AND `livemode` = ? AND `event_id` = ? ORDER BY `received_at`, `id`",
		scope.AccountID, scope.Livemode, scope.EventID).Scan(&deliveries).Error; err != nil {
		return eventadmin.Detail{}, fmt.Errorf("read webhook deliveries: %w", err)
	}
	d := eventadmin.Detail{Event: rows[0].event(), Deliveries: make([]eventadmin.Delivery, 0, len(deliveries))}
	for _, dl := range deliveries {
		d.Deliveries = append(d.Deliveries, eventadmin.Delivery{ID: dl.ID, ReceivedAt: time.UnixMilli(dl.ReceivedAt)})
		if dl.ID == rows[0].FirstDeliveryID {
			d.Payload = dl.Payload
		}
	}
	return d, nil
}

func (r webhookEventRow) event() eventadmin.Event {
	s := r.storedTask()
	return eventadmin.Event{
		Scope:      s.Scope,
		APIVersion: s.APIVersion,
		Created:    time.Unix(r.Created, 0),
		Refs: webhookevent.References{
			SubscriptionID:    r.SubscriptionID,
			CustomerID:        r.CustomerID,
			CheckoutSessionID: r.CheckoutSessionID,
			InvoiceID:         r.InvoiceID,
			PaymentIntentID:   r.PaymentIntentID,
			ChargeID:          r.ChargeID,
		},
		Task: s.Task,
	}
}

// Save writes next as scope's task, and applies effects, in one
// transaction, only while the stored Status, Attempts and ClaimToken still
// equal read's; otherwise it returns webhookevent.ErrStaleClaim and
// changes nothing. Effects it has no applier for, or that fail to apply,
// roll the task back with them. The alert is left out of the condition and
// only written where none was raised yet, so a task save never undoes a
// send or a claim the notifier recorded.
func (s WebhookEvents) Save(ctx context.Context, scope webhookevent.Scope, read, next webhookevent.Task, effects webhookevent.Effects) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec("UPDATE `stripe_webhook_events` SET `status` = ?, `attempts` = ?, `last_error` = ?, "+
			"`first_wait_at` = ?, `next_attempt_at` = ?, `completed_at` = ?, `claim_token` = ?, `claim_expires_at` = ?, `updated_at` = ? "+
			"WHERE `stripe_account_id` = ? AND `livemode` = ? AND `event_id` = ? "+
			"AND `status` = ? AND `attempts` = ? AND `claim_token` = ?",
			string(next.Status), next.Attempts, next.LastError, unixMilliOrNil(next.FirstWaitAt), unixMilliOrNil(next.NextAttemptAt),
			unixMilliOrNil(next.CompletedAt), next.ClaimToken, unixMilliOrNil(next.ClaimExpiresAt), time.Now().UnixMilli(),
			scope.AccountID, scope.Livemode, scope.EventID,
			string(read.Status), read.Attempts, read.ClaimToken)
		if res.Error != nil {
			return fmt.Errorf("save webhook event task: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			return staleOrMissing(tx, scope)
		}
		if err := raiseAlert(tx, scope, next.Alert); err != nil {
			return err
		}
		if effects == nil {
			return nil
		}
		if s.apply == nil {
			return fmt.Errorf("save webhook event task: no applier for effects %T", effects)
		}
		if err := s.apply(tx, scope, effects); err != nil {
			return fmt.Errorf("apply webhook event effects: %w", err)
		}
		return nil
	})
}

// raiseAlert stores webhookevent.AlertToSave(stored, a): a's alert only
// where none was raised yet. Delivery progress belongs to the notifier, so
// the condition sits in the UPDATE rather than on a value read earlier.
func raiseAlert(tx *gorm.DB, scope webhookevent.Scope, a alert.Alert) error {
	if a.State == "" {
		return nil
	}
	if err := tx.Exec("UPDATE `stripe_webhook_events` SET `alert_state` = ?, `alert_attempts` = ?, `alert_last_error` = ?, "+
		"`alert_next_attempt_at` = ?, `alert_sent_at` = ?, `alert_claim_token` = ?, `alert_claim_expires_at` = ? "+
		"WHERE `stripe_account_id` = ? AND `livemode` = ? AND `event_id` = ? AND `alert_state` = ''",
		string(a.State), a.Attempts, a.LastError, unixMilliOrNil(a.NextAttemptAt), unixMilliOrNil(a.SentAt),
		a.ClaimToken, unixMilliOrNil(a.ClaimExpiresAt),
		scope.AccountID, scope.Livemode, scope.EventID).Error; err != nil {
		return fmt.Errorf("raise webhook event alert: %w", err)
	}
	return nil
}

// staleOrMissing explains a conditional write that matched no row: the
// task moved on, or the event was never received.
func staleOrMissing(tx *gorm.DB, scope webhookevent.Scope) error {
	var n int64
	if err := tx.Raw("SELECT count(*) FROM `stripe_webhook_events` WHERE `stripe_account_id` = ? AND `livemode` = ? AND `event_id` = ?",
		scope.AccountID, scope.Livemode, scope.EventID).Scan(&n).Error; err != nil {
		return fmt.Errorf("read webhook event task: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("save webhook event task: no event %s in %s (livemode %t)", scope.EventID, scope.AccountID, scope.Livemode)
	}
	return webhookevent.ErrStaleClaim
}

// timeOrZero reads a nullable Unix-millisecond column.
func timeOrZero(ms *int64) time.Time {
	if ms == nil {
		return time.Time{}
	}
	return time.UnixMilli(*ms)
}
