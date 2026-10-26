package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/chargerefunded"
	"enx-api/billing/creditperiod"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ChargeRefunds is chargerefunded.Store over the webhook deliveries, the
// credit ledger and its provenance, credit_accounts and the deletion gate
// (ADR-049 Decisions 7 and 8, ADR-067 §积分周期与退款来源). ApplyClawback
// writes what it decides.
type ChargeRefunds struct{}

var _ chargerefunded.Store = ChargeRefunds{}

// Payload reads scope's event's original payload.
func (ChargeRefunds) Payload(ctx context.Context, scope webhookevent.Scope) ([]byte, error) {
	return eventPayload(sqlitex.DB.WithContext(ctx), scope)
}

// GrantForPaymentIntent reads the GRANT_TOPUP or GRANT_SUBSCRIPTION row that
// recorded paymentIntentID, with what earlier clawbacks of it took. Two
// grants of one PaymentIntent are an error rather than a guess between them.
func (ChargeRefunds) GrantForPaymentIntent(ctx context.Context, paymentIntentID string) (chargerefunded.Grant, bool, error) {
	db := sqlitex.DB.WithContext(ctx)
	var rows []struct {
		ID                   string
		UserID               string
		Type                 string
		Amount               int64
		StripeSubscriptionID *string
		PeriodStart          *int64
		PeriodEnd            *int64
		WithoutPeriod        bool
		Applied              *int64
		Revision             int64
	}
	// Backfill updates provenance and billing_version atomically. Read both
	// in one statement so Owner cannot pair old provenance with a new revision.
	if err := db.Raw("SELECT t.`id`, t.`user_id`, t.`type`, t.`amount`, t.`stripe_subscription_id`, t.`period_start`, t.`period_end`, "+
		"t.`without_period`, t.`applied`, COALESCE(u.`billing_version`, 0) AS revision FROM `credit_transactions` t "+
		"LEFT JOIN `users` u ON u.`id` = t.`user_id` WHERE t.`stripe_payment_intent_id` = ? AND t.`type` IN (?, ?)",
		paymentIntentID, typeGrantTopUp, typeGrantSubscription).Scan(&rows).Error; err != nil {
		return chargerefunded.Grant{}, false, fmt.Errorf("read grant of %s: %w", paymentIntentID, err)
	}
	switch len(rows) {
	case 0:
		return chargerefunded.Grant{}, false, nil
	case 1:
	default:
		return chargerefunded.Grant{}, false, fmt.Errorf("read grant of %s: %d grants record it", paymentIntentID, len(rows))
	}
	r := rows[0]
	g := chargerefunded.Grant{ID: r.ID, UserID: r.UserID, Pool: chargerefunded.PoolTopUp, Credits: r.Amount}
	if r.Type == typeGrantSubscription {
		g = chargerefunded.Grant{ID: r.ID, UserID: r.UserID, Pool: chargerefunded.PoolSubscription}
		// A legacy row's amount is what it applied.
		g.Period = creditperiod.Grant{WithoutPeriod: r.WithoutPeriod, Applied: r.Amount}
		if r.Applied != nil {
			g.Period.Applied = *r.Applied
		}
		g.Period.Source = grantSource(r.StripeSubscriptionID, r.PeriodStart, r.PeriodEnd)
	}
	g.Revision = r.Revision
	var err error
	if g.Taken, err = clawedBack(db, r.ID); err != nil {
		return chargerefunded.Grant{}, false, err
	}
	return g, true, nil
}

// ClawbackRecorded reports whether the ledger holds scope's event's CLAWBACK.
func (ChargeRefunds) ClawbackRecorded(ctx context.Context, scope webhookevent.Scope) (bool, error) {
	var n int64
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT count(*) FROM `credit_transactions` WHERE `type` = ? AND `stripe_event_id` = ?",
		typeClawback, scope.EventID).Scan(&n).Error; err != nil {
		return false, fmt.Errorf("read clawback of %s: %w", scope.EventID, err)
	}
	return n > 0, nil
}

// Owner reads userID's billing revision, deletion state, subscription
// balance and pool provenance in one read transaction. A user with no users
// row and no gate was deleted before the gate existed: the ledger outlives
// the account, so a refund of their grant reads as DeletionCompleted.
func (ChargeRefunds) Owner(ctx context.Context, userID string) (chargerefunded.Owner, error) {
	var o chargerefunded.Owner
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
		if o.SubscriptionBalance, _, err = poolBalance(tx, userID, chargerefunded.PoolSubscription); err != nil {
			return err
		}
		o.Pool, err = poolProvenance(tx, userID)
		return err
	})
	if err != nil {
		return chargerefunded.Owner{}, fmt.Errorf("read refund owner %s: %w", userID, err)
	}
	return o, nil
}

// ApplyClawback writes e inside tx, the transaction that saves scope's
// task: it takes e.Clawback.Credits from the grant's pool (a top-up pool may
// go negative) and records a CLAWBACK ledger row linked to the grant, keyed
// by scope's Event ID, even when it takes nothing. A deleted user's refund
// takes nothing and recreates no balance. When the owner's billing
// revision, the grant's clawback total or, for the subscription pool, the
// subscription balance is no longer what e.Observed read, it is
// chargerefunded.ErrStale, with nothing written.
func ApplyClawback(tx *gorm.DB, scope webhookevent.Scope, e chargerefunded.Effects) error {
	c := e.Clawback
	if c == nil {
		return nil
	}
	revision, _, err := billingRevision(tx, e.Observed.UserID)
	if err != nil {
		return err
	}
	taken, err := clawedBack(tx, e.Observed.GrantID)
	if err != nil {
		return err
	}
	balance, hasAccount, err := poolBalance(tx, c.UserID, c.Pool)
	if err != nil {
		return err
	}
	if revision != e.Observed.Revision || taken != e.Observed.Taken ||
		(c.Pool == chargerefunded.PoolSubscription && balance != e.Observed.SubscriptionBalance) {
		return chargerefunded.ErrStale
	}

	now := time.Now().UnixMilli()
	if c.Credits > 0 {
		if !hasAccount {
			return fmt.Errorf("claw back %d credits of grant %s: user %s has no credit account", c.Credits, c.GrantID, c.UserID)
		}
		column := poolColumn(c.Pool)
		if err := tx.Exec("UPDATE `credit_accounts` SET `"+column+"` = `"+column+"` - ?, `updated_at` = ? WHERE `user_id` = ?",
			c.Credits, now, c.UserID).Error; err != nil {
			return fmt.Errorf("claw back grant %s: %w", c.GrantID, err)
		}
		balance -= c.Credits
	}
	if err := tx.Exec("INSERT INTO `credit_transactions` (`id`, `user_id`, `type`, `amount`, `balance_after`, `stripe_event_id`, "+
		"`related_transaction_id`, `note`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		uuid.New().String(), c.UserID, typeClawback, -c.Credits, balance, scope.EventID, c.GrantID,
		fmt.Sprintf("Stripe charge %s, %d of %d refunded", c.ChargeID, c.Refunded, c.Captured), now).Error; err != nil {
		return fmt.Errorf("record clawback of grant %s: %w", c.GrantID, err)
	}
	return nil
}

const (
	typeGrantTopUp        = "GRANT_TOPUP"
	typeGrantSubscription = "GRANT_SUBSCRIPTION"
	typeClawback          = "CLAWBACK"
)

// eventPayload reads the original payload of scope's event's first
// delivery.
func eventPayload(db *gorm.DB, scope webhookevent.Scope) ([]byte, error) {
	var payloads [][]byte
	if err := db.Raw("SELECT d.`payload` FROM `stripe_webhook_events` e "+
		"JOIN `stripe_webhook_deliveries` d ON d.`id` = e.`first_delivery_id` "+
		"WHERE e.`stripe_account_id` = ? AND e.`livemode` = ? AND e.`event_id` = ?",
		scope.AccountID, scope.Livemode, scope.EventID).Scan(&payloads).Error; err != nil {
		return nil, fmt.Errorf("read payload of %s: %w", scope.EventID, err)
	}
	if len(payloads) == 0 {
		return nil, fmt.Errorf("read payload: no event %s in %s (livemode %t)", scope.EventID, scope.AccountID, scope.Livemode)
	}
	return payloads[0], nil
}

// billingRevision reads userID's billing revision; exists is false, with
// revision 0, when the users row is gone.
func billingRevision(tx *gorm.DB, userID string) (revision int64, exists bool, err error) {
	var versions []int64
	if err := tx.Raw("SELECT `billing_version` FROM `users` WHERE `id` = ?", userID).Scan(&versions).Error; err != nil {
		return 0, false, fmt.Errorf("read billing revision: %w", err)
	}
	if len(versions) == 0 {
		return 0, false, nil
	}
	return versions[0], true, nil
}

// clawedBack is what the CLAWBACK rows linked to grantID took.
func clawedBack(tx *gorm.DB, grantID string) (int64, error) {
	var taken int64
	if err := tx.Raw("SELECT COALESCE(-SUM(`amount`), 0) FROM `credit_transactions` WHERE `related_transaction_id` = ? AND `type` = ?",
		grantID, typeClawback).Scan(&taken).Error; err != nil {
		return 0, fmt.Errorf("read clawbacks of %s: %w", grantID, err)
	}
	return taken, nil
}

func poolColumn(pool chargerefunded.Pool) string {
	if pool == chargerefunded.PoolSubscription {
		return "subscription_balance"
	}
	return "topup_balance"
}

// poolBalance reads userID's balance in pool; exists is false, with 0, when
// the user has no credit account.
func poolBalance(tx *gorm.DB, userID string, pool chargerefunded.Pool) (balance int64, exists bool, err error) {
	var balances []int64
	if err := tx.Raw("SELECT `"+poolColumn(pool)+"` FROM `credit_accounts` WHERE `user_id` = ?", userID).Scan(&balances).Error; err != nil {
		return 0, false, fmt.Errorf("read %s: %w", poolColumn(pool), err)
	}
	if len(balances) == 0 {
		return 0, false, nil
	}
	return balances[0], true, nil
}

// poolProvenance reads where userID's subscription_balance came from: the
// grant credit_accounts.pool_grant_id points at. A migrated grant with no
// recorded subscription is BackfillPending until the legacy provenance
// backfill marks itself done, and an old grant with no provenance after it.
func poolProvenance(tx *gorm.DB, userID string) (creditperiod.Pool, error) {
	var rows []struct {
		StripeSubscriptionID *string
		PeriodStart          *int64
		PeriodEnd            *int64
		WithoutPeriod        bool
	}
	if err := tx.Raw("SELECT t.`stripe_subscription_id`, t.`period_start`, t.`period_end`, t.`without_period` "+
		"FROM `credit_accounts` a JOIN `credit_transactions` t ON t.`id` = a.`pool_grant_id` WHERE a.`user_id` = ?",
		userID).Scan(&rows).Error; err != nil {
		return creditperiod.Pool{}, fmt.Errorf("read pool provenance: %w", err)
	}
	if len(rows) == 0 {
		return creditperiod.Pool{}, nil
	}
	r := rows[0]
	if r.StripeSubscriptionID == nil {
		var marks int64
		if err := tx.Raw("SELECT count(*) FROM `schema_migrations` WHERE `version` = ?", LegacyBackfillMarker).Scan(&marks).Error; err != nil {
			return creditperiod.Pool{}, fmt.Errorf("read legacy backfill marker: %w", err)
		}
		return creditperiod.Pool{BackfillPending: marks == 0}, nil
	}
	return creditperiod.Pool{Source: grantSource(r.StripeSubscriptionID, r.PeriodStart, r.PeriodEnd), WithoutPeriod: r.WithoutPeriod}, nil
}

// grantSource is a grant's recorded subscription and period; zero when it
// has none.
func grantSource(subscriptionID *string, start, end *int64) creditperiod.Source {
	if subscriptionID == nil {
		return creditperiod.Source{}
	}
	s := creditperiod.Source{SubscriptionID: *subscriptionID}
	if start != nil {
		s.Period.Start = *start
	}
	if end != nil {
		s.Period.End = *end
	}
	return s
}
