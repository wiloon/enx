package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/chargerefunded"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CheckoutCompleted is checkoutcompleted.Store over the webhook events, the
// Customer ownership table, the subscriptions rows and the credit ledger
// (ADR-067 §一次性充值与 Stripe Customer, §用户关联与乱序恢复). Endpoint is
// the configured account and mode a top-up's Checkout Session is looked up in.
type CheckoutCompleted struct {
	Endpoint webhookevent.Endpoint
}

var _ checkoutcompleted.Store = CheckoutCompleted{}

// Payload reads scope's event's original payload.
func (CheckoutCompleted) Payload(ctx context.Context, scope webhookevent.Scope) ([]byte, error) {
	return eventPayload(sqlitex.DB.WithContext(ctx), scope)
}

// TopUpRecorded reports whether any event of the endpoint for the Checkout
// Session has a GRANT_TOPUP on the ledger. A grant from before the cutover has
// no event row and is deliberately not found (ADR-067, owner decision A).
func (s CheckoutCompleted) TopUpRecorded(ctx context.Context, checkoutSessionID string) (bool, error) {
	return topUpRecorded(sqlitex.DB.WithContext(ctx), s.Endpoint, checkoutSessionID)
}

func topUpRecorded(db *gorm.DB, endpoint webhookevent.Endpoint, checkoutSessionID string) (bool, error) {
	var n int64
	if err := db.Raw("SELECT count(*) FROM `stripe_webhook_events` e JOIN `credit_transactions` t ON t.`stripe_event_id` = e.`event_id` "+
		"WHERE e.`stripe_account_id` = ? AND e.`livemode` = ? AND e.`checkout_session_id` = ? AND t.`type` = ?",
		endpoint.AccountID, endpoint.Livemode, checkoutSessionID, typeGrantTopUp).Scan(&n).Error; err != nil {
		return false, fmt.Errorf("read top-up of %s: %w", checkoutSessionID, err)
	}
	return n > 0, nil
}

// CustomerOwner is the user stripe_customers records customerID for, "" when
// there is none.
func (CheckoutCompleted) CustomerOwner(ctx context.Context, customerID string) (string, error) {
	return customerOwner(sqlitex.DB.WithContext(ctx), customerID)
}

func customerOwner(db *gorm.DB, customerID string) (string, error) {
	var owners []string
	if err := db.Raw("SELECT `user_id` FROM `stripe_customers` WHERE `stripe_customer_id` = ?", customerID).Scan(&owners).Error; err != nil {
		return "", fmt.Errorf("read owner of Customer %s: %w", customerID, err)
	}
	if len(owners) == 0 {
		return "", nil
	}
	return owners[0], nil
}

// Subscription reads subscriptionID's row. Its stored Checkout association is
// the client_reference_id of the earliest processed checkout.session.completed
// event that names it: the association has no column of its own, and the
// event completes in the same transaction that creates the row.
func (CheckoutCompleted) Subscription(ctx context.Context, subscriptionID string) (checkoutcompleted.Subscription, error) {
	db := sqlitex.DB.WithContext(ctx)
	sub, err := checkoutSubscriptionRow(db, subscriptionID)
	if err != nil || !sub.Known {
		return checkoutcompleted.Subscription{}, err
	}
	var payloads [][]byte
	if err := db.Raw("SELECT d.`payload` FROM `stripe_webhook_events` e JOIN `stripe_webhook_deliveries` d ON d.`id` = e.`first_delivery_id` "+
		"WHERE e.`subscription_id` = ? AND e.`type` = 'checkout.session.completed' AND e.`status` = ? "+
		"ORDER BY e.`first_received_at`, e.`event_id` LIMIT 1", subscriptionID, string(webhookevent.Processed)).Scan(&payloads).Error; err != nil {
		return checkoutcompleted.Subscription{}, fmt.Errorf("read Checkout association of %s: %w", subscriptionID, err)
	}
	if len(payloads) > 0 {
		cs, err := checkoutcompleted.DecodeEvent(payloads[0])
		if err != nil {
			return checkoutcompleted.Subscription{}, fmt.Errorf("read Checkout association of %s: %w", subscriptionID, err)
		}
		sub.CheckoutUserID = cs.ClientReferenceID
	}
	return sub, nil
}

// checkoutSubscriptionRow reads whether ENX has subscriptionID's row, with its owner
// and version.
func checkoutSubscriptionRow(db *gorm.DB, subscriptionID string) (checkoutcompleted.Subscription, error) {
	var rows []struct {
		UserID  *string
		Version int64
	}
	if err := db.Raw("SELECT `user_id`, `version` FROM `subscriptions` WHERE `stripe_subscription_id` = ?",
		subscriptionID).Scan(&rows).Error; err != nil {
		return checkoutcompleted.Subscription{}, fmt.Errorf("read subscription %s: %w", subscriptionID, err)
	}
	if len(rows) == 0 {
		return checkoutcompleted.Subscription{}, nil
	}
	return checkoutcompleted.Subscription{Known: true, OwnerUserID: deref(rows[0].UserID), Version: rows[0].Version}, nil
}

// Owner reads userID's billing revision and deletion state in one read
// transaction. A user with no users row and no gate was deleted before the
// gate existed, which reads as DeletionCompleted.
func (CheckoutCompleted) Owner(ctx context.Context, userID string) (checkoutcompleted.Owner, error) {
	var o checkoutcompleted.Owner
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		if o.Deletion, err = deletionState(tx, userID); err != nil {
			return err
		}
		var exists bool
		if o.Revision, exists, err = billingRevision(tx, userID); err != nil {
			return err
		}
		if !exists && o.Deletion == acceptance.NoDeletion {
			o.Deletion = acceptance.DeletionCompleted
		}
		return nil
	})
	if err != nil {
		return checkoutcompleted.Owner{}, fmt.Errorf("read checkout owner %s: %w", userID, err)
	}
	return o, nil
}

// WebhookEffects applies the effects of the webhook event handlers. The zero
// value applies everything except a referral first-payment handoff, which
// needs the referral terms.
type WebhookEffects struct {
	// Referral supplies the terms the first-payment handoff rewards by.
	Referral referral.CreditPolicy
	// Now is the clock; time.Now when nil.
	Now func() time.Time
}

// Apply is the EffectApplier of the webhook event TaskStore.
func (w WebhookEffects) Apply(tx *gorm.DB, scope webhookevent.Scope, effects webhookevent.Effects) error {
	switch e := effects.(type) {
	case checkoutcompleted.Effects:
		return w.applyCheckoutCompleted(tx, scope, e)
	}
	return applySnapshotOrClawback(tx, scope, effects)
}

func (w WebhookEffects) now() time.Time {
	if w.Now != nil {
		return w.Now()
	}
	return time.Now()
}

// applyCheckoutCompleted writes e inside tx, the transaction that saves
// scope's task. It first revalidates what e.Observed read: the payer's billing
// revision, the Customer's owner and the subscription row. A top-up is also
// looked up again by Checkout Session, since another event's grant may have
// committed after the handler's lookup but before its Owner read. Anything
// moved on is checkoutcompleted.ErrStale with nothing written. Every effect
// that changes the payer's entitlement context moves their billing revision on.
func (w WebhookEffects) applyCheckoutCompleted(tx *gorm.DB, scope webhookevent.Scope, e checkoutcompleted.Effects) error {
	o := e.Observed
	revision, userExists, err := billingRevision(tx, o.UserID)
	if err != nil {
		return err
	}
	if revision != o.Revision {
		return checkoutcompleted.ErrStale
	}
	if o.CustomerID != "" {
		owner, err := customerOwner(tx, o.CustomerID)
		if err != nil {
			return err
		}
		if owner != o.CustomerOwner {
			return checkoutcompleted.ErrStale
		}
	}
	if o.SubscriptionID != "" {
		sub, err := checkoutSubscriptionRow(tx, o.SubscriptionID)
		if err != nil {
			return err
		}
		if sub.Known != o.SubscriptionKnown || sub.Version != o.SubscriptionVersion {
			return checkoutcompleted.ErrStale
		}
	}
	now := w.now()

	changed := false
	if c := e.Customer; c != nil {
		res := tx.Exec("INSERT INTO `stripe_customers` (`stripe_customer_id`, `user_id`, `created_at`) VALUES (?, ?, ?) "+
			"ON CONFLICT (`stripe_customer_id`) DO NOTHING", c.CustomerID, c.UserID, now.UnixMilli())
		if res.Error != nil {
			return fmt.Errorf("record Customer %s: %w", c.CustomerID, res.Error)
		}
		if res.RowsAffected == 0 {
			return checkoutcompleted.ErrStale
		}
		changed = true
	}
	if a := e.Association; a != nil {
		if err := associateCheckout(tx, scope, *a, o, now); err != nil {
			return err
		}
		changed = true
	}
	if t := e.TopUp; t != nil {
		recorded, err := topUpRecorded(tx, webhookevent.Endpoint{AccountID: scope.AccountID, Livemode: scope.Livemode}, t.CheckoutSessionID)
		if err != nil {
			return err
		}
		if recorded {
			return checkoutcompleted.ErrStale
		}
		if err := grantTopUp(tx, scope, *t, now); err != nil {
			return err
		}
		changed = true
	}
	if changed && userExists {
		res := tx.Exec("UPDATE `users` SET `billing_version` = `billing_version` + 1 WHERE `id` = ? AND `billing_version` = ?", o.UserID, o.Revision)
		if res.Error != nil {
			return fmt.Errorf("move billing revision on: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			return checkoutcompleted.ErrStale
		}
	}
	if p := e.FirstPayment; p != nil {
		if w.Referral == nil {
			return errors.New("record first payment: no referral terms configured")
		}
		svc := referral.NewService(nil, Referrals{tx: tx}, nil, nil, nil, w.now, w.Referral)
		if err := svc.RecordFirstPayment(tx.Statement.Context, o.UserID, *p); err != nil {
			return fmt.Errorf("record first payment of %s: %w", o.UserID, err)
		}
	}
	return nil
}

// associateCheckout stores the Checkout's subscription: a new row with no
// owner and no classification where ENX had none, otherwise a version move on
// of the row it observed. It then makes the subscription's waiting events due
// (webhookevent.Wake), so invoice.paid attributes and accepts it.
func associateCheckout(tx *gorm.DB, scope webhookevent.Scope, a checkoutcompleted.CheckoutAssociation, o checkoutcompleted.Observed, now time.Time) error {
	at := now.UnixMilli()
	if !o.SubscriptionKnown {
		res := tx.Exec("INSERT INTO `subscriptions` (`stripe_subscription_id`, `user_id`, `stripe_customer_id`, `status`, `created_at`, `updated_at`) "+
			"VALUES (?, NULL, ?, 'none', ?, ?) ON CONFLICT (`stripe_subscription_id`) DO NOTHING", a.SubscriptionID, a.CustomerID, at, at)
		if res.Error != nil {
			return fmt.Errorf("create subscription %s: %w", a.SubscriptionID, res.Error)
		}
		if res.RowsAffected == 0 {
			return checkoutcompleted.ErrStale
		}
	} else {
		res := tx.Exec("UPDATE `subscriptions` SET `version` = `version` + 1, `updated_at` = ? WHERE `stripe_subscription_id` = ? AND `version` = ?",
			at, a.SubscriptionID, o.SubscriptionVersion)
		if res.Error != nil {
			return fmt.Errorf("associate subscription %s: %w", a.SubscriptionID, res.Error)
		}
		if res.RowsAffected == 0 {
			return checkoutcompleted.ErrStale
		}
	}
	if err := tx.Exec("UPDATE `stripe_webhook_events` SET `next_attempt_at` = ?, `updated_at` = ? "+
		"WHERE `stripe_account_id` = ? AND `livemode` = ? AND `subscription_id` = ? AND `status` = ? AND `next_attempt_at` > ?",
		at, at, scope.AccountID, scope.Livemode, a.SubscriptionID, string(webhookevent.WaitingDependency), at).Error; err != nil {
		return fmt.Errorf("wake events of %s: %w", a.SubscriptionID, err)
	}
	return nil
}

// grantTopUp adds t.Credits to the payer's top-up pool and records the
// GRANT_TOPUP keyed by scope's Event ID, which stays unique on the ledger.
func grantTopUp(tx *gorm.DB, scope webhookevent.Scope, t checkoutcompleted.TopUp, now time.Time) error {
	at := now.UnixMilli()
	if err := tx.Exec("INSERT INTO `credit_accounts` (`user_id`, `updated_at`) VALUES (?, ?) ON CONFLICT (`user_id`) DO NOTHING", t.UserID, at).Error; err != nil {
		return fmt.Errorf("ensure credit account of %s: %w", t.UserID, err)
	}
	if err := tx.Exec("UPDATE `credit_accounts` SET `topup_balance` = `topup_balance` + ?, `updated_at` = ? WHERE `user_id` = ?",
		t.Credits, at, t.UserID).Error; err != nil {
		return fmt.Errorf("grant top-up of %s: %w", t.CheckoutSessionID, err)
	}
	balance, _, err := poolBalance(tx, t.UserID, chargerefunded.PoolTopUp)
	if err != nil {
		return err
	}
	var paymentIntent any
	if t.PaymentIntentID != "" {
		paymentIntent = t.PaymentIntentID
	}
	if err := tx.Exec("INSERT INTO `credit_transactions` (`id`, `user_id`, `type`, `amount`, `balance_after`, `stripe_event_id`, "+
		"`stripe_payment_intent_id`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		uuid.New().String(), t.UserID, typeGrantTopUp, t.Credits, balance, scope.EventID, paymentIntent, at).Error; err != nil {
		return fmt.Errorf("record top-up of %s: %w", t.CheckoutSessionID, err)
	}
	return nil
}
