package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/chargerefunded"
	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// SubscriptionSnapshots is snapshot.Store over the subscriptions rows
// (ADR-067 §积分随 Stripe 事件调整). ApplySnapshot writes what it decides.
type SubscriptionSnapshots struct{}

var _ snapshot.Store = SubscriptionSnapshots{}

// Subscription reads whether ENX has subscriptionID's row, and its version.
func (SubscriptionSnapshots) Subscription(ctx context.Context, subscriptionID string) (snapshot.Subscription, error) {
	var versions []int64
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT `version` FROM `subscriptions` WHERE `stripe_subscription_id` = ?",
		subscriptionID).Scan(&versions).Error; err != nil {
		return snapshot.Subscription{}, fmt.Errorf("read subscription snapshot: %w", err)
	}
	if len(versions) == 0 {
		return snapshot.Subscription{}, nil
	}
	return snapshot.Subscription{Known: true, Version: versions[0]}, nil
}

// ApplyWebhookEffects is the EffectApplier the webhook event worker's
// TaskStore commits a handled event's effects with. It applies a Checkout's
// first-payment handoff only through WebhookEffects, which carries the
// referral terms.
func ApplyWebhookEffects(tx *gorm.DB, scope webhookevent.Scope, effects webhookevent.Effects) error {
	return WebhookEffects{}.Apply(tx, scope, effects)
}

func applySnapshotOrClawback(tx *gorm.DB, scope webhookevent.Scope, effects webhookevent.Effects) error {
	switch e := effects.(type) {
	case snapshot.Effects:
		return ApplySnapshot(tx, e)
	case chargerefunded.Effects:
		return ApplyClawback(tx, scope, e)
	}
	return fmt.Errorf("no applier for webhook effects %T", effects)
}

// ApplySnapshot writes e inside tx: the snapshot columns of a row still at
// e.Version, moving its version on, or a new row with no owner and no
// classification where e observed none. A row that moved on or appeared
// since is snapshot.ErrStale, with nothing written. The owner, Customer,
// classification and conflict investigation are never touched. A status
// change moves the owner's billing revision on: a stored status is the
// deletion check's ended evidence (eligibility.NeedsLiveLookup).
func ApplySnapshot(tx *gorm.DB, e snapshot.Effects) error {
	if !e.Known {
		return insertSnapshot(tx, e)
	}
	var rows []struct {
		UserID  *string
		Status  string
		Version int64
	}
	if err := tx.Raw("SELECT `user_id`, `status`, `version` FROM `subscriptions` WHERE `stripe_subscription_id` = ?",
		e.SubscriptionID).Scan(&rows).Error; err != nil {
		return fmt.Errorf("read subscription snapshot: %w", err)
	}
	if len(rows) == 0 || rows[0].Version != e.Version {
		return snapshot.ErrStale
	}
	s := e.State
	res := tx.Exec("UPDATE `subscriptions` SET `status` = ?, `plan` = ?, `price_id` = ?, `current_period_end` = ?, "+
		"`cancel_at_period_end` = ?, `cancel_at` = ?, `pending_update` = ?, `has_schedule` = ?, "+
		"`version` = `version` + 1, `updated_at` = ? "+
		"WHERE `stripe_subscription_id` = ? AND `version` = ?",
		s.Status, e.Tier, e.PriceID, s.CurrentPeriodEnd, s.CancelAtPeriodEnd, s.CancelAt, s.PendingUpdate, s.HasSchedule,
		time.Now().UnixMilli(), e.SubscriptionID, e.Version)
	if res.Error != nil {
		return fmt.Errorf("save subscription snapshot: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return snapshot.ErrStale
	}
	if owner := deref(rows[0].UserID); owner != "" && rows[0].Status != s.Status {
		if err := tx.Exec("UPDATE `users` SET `billing_version` = `billing_version` + 1 WHERE `id` = ?", owner).Error; err != nil {
			return fmt.Errorf("move billing revision on: %w", err)
		}
	}
	return nil
}

func insertSnapshot(tx *gorm.DB, e snapshot.Effects) error {
	s := e.State
	now := time.Now().UnixMilli()
	res := tx.Exec("INSERT INTO `subscriptions` (`stripe_subscription_id`, `user_id`, `stripe_customer_id`, `status`, `plan`, "+
		"`price_id`, `current_period_end`, `cancel_at_period_end`, `cancel_at`, `pending_update`, `has_schedule`, "+
		"`created_at`, `updated_at`) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "+
		"ON CONFLICT (`stripe_subscription_id`) DO NOTHING",
		e.SubscriptionID, e.CustomerID, s.Status, e.Tier, e.PriceID, s.CurrentPeriodEnd,
		s.CancelAtPeriodEnd, s.CancelAt, s.PendingUpdate, s.HasSchedule, now, now)
	if res.Error != nil {
		return fmt.Errorf("create subscription snapshot: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return snapshot.ErrStale
	}
	return nil
}
