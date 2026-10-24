package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// EffectApplier applies a handled event's webhookevent.Effects inside tx,
// the transaction that saves the event's task. An error rolls the task
// back with them.
type EffectApplier func(tx *gorm.DB, effects webhookevent.Effects) error

// WebhookEvents is webhookevent.TaskStore over the stripe_webhook_events
// rows WebhookReceipts creates (ADR-067).
type WebhookEvents struct {
	apply EffectApplier
}

var _ webhookevent.TaskStore = WebhookEvents{}

// NewWebhookEvents returns the store. apply applies the effects the
// worker's handler returns; nil means Save accepts no effects.
func NewWebhookEvents(apply EffectApplier) WebhookEvents {
	return WebhookEvents{apply: apply}
}

// webhookEventRow is a stripe_webhook_events row as Unfinished reads it.
type webhookEventRow struct {
	StripeAccountID     string
	Livemode            bool
	EventID             string
	Type                string
	APIVersion          string
	SubscriptionID      string
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

// Unfinished returns every pending, processing or waiting task, oldest
// receipt first.
func (WebhookEvents) Unfinished(ctx context.Context) ([]webhookevent.StoredTask, error) {
	var rows []webhookEventRow
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT `stripe_account_id`, `livemode`, `event_id`, `type`, `api_version`, `subscription_id`, "+
		"`status`, `attempts`, `last_error`, `first_wait_at`, `next_attempt_at`, `completed_at`, `claim_token`, `claim_expires_at`, "+
		"`alert_state`, `alert_attempts`, `alert_last_error`, `alert_next_attempt_at`, `alert_sent_at`, `alert_claim_token`, `alert_claim_expires_at` "+
		"FROM `stripe_webhook_events` WHERE `status` IN (?, ?, ?) ORDER BY `first_received_at`, `event_id`",
		string(webhookevent.Pending), string(webhookevent.Processing), string(webhookevent.WaitingDependency)).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read unfinished webhook events: %w", err)
	}
	tasks := make([]webhookevent.StoredTask, 0, len(rows))
	for _, r := range rows {
		tasks = append(tasks, webhookevent.StoredTask{
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
		})
	}
	return tasks, nil
}

// LegacyBackfillMarker is the schema_migrations row that records the
// one-time legacy provenance backfill finished (ADR-067 §一次性充值与
// Stripe Customer). Like a migration it runs once per database, after the
// cutover migrations and before the worker claims subscription invoices.
const LegacyBackfillMarker = "297-legacy-provenance-backfill-v1"

// LegacyBackfillDone reports whether MarkLegacyBackfillDone has run.
func (WebhookEvents) LegacyBackfillDone(ctx context.Context) (bool, error) {
	var n int64
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT count(*) FROM `schema_migrations` WHERE `version` = ?",
		LegacyBackfillMarker).Scan(&n).Error; err != nil {
		return false, fmt.Errorf("read legacy backfill marker: %w", err)
	}
	return n > 0, nil
}

// MarkLegacyBackfillDone records that the legacy provenance backfill
// finished, for legacyprovenance.Store.MarkDone. Marking twice is a no-op.
func MarkLegacyBackfillDone(ctx context.Context) error {
	if err := sqlitex.DB.WithContext(ctx).Exec("INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (?, ?) "+
		"ON CONFLICT (`version`) DO NOTHING", LegacyBackfillMarker, time.Now().UnixMilli()).Error; err != nil {
		return fmt.Errorf("mark legacy backfill done: %w", err)
	}
	return nil
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
		if err := s.apply(tx, effects); err != nil {
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
