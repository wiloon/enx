package repo

import (
	"context"
	"fmt"
	"strings"

	"enx-api/billing/acceptance"
	"enx-api/billing/chargerefunded"
	"enx-api/billing/conflict"
	"enx-api/billing/creditperiod"
	"enx-api/billing/invoicepaid"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// InvoicePaid is invoicepaid.Store over the webhook events, the subscriptions
// rows, the owner's accepted pointer and the credit ledger with its
// provenance (ADR-067 §订阅归属与接受关系, §积分周期与退款来源).
type InvoicePaid struct{}

var _ invoicepaid.Store = InvoicePaid{}

// Payload reads scope's event's original payload.
func (InvoicePaid) Payload(ctx context.Context, scope webhookevent.Scope) ([]byte, error) {
	return eventPayload(sqlitex.DB.WithContext(ctx), scope)
}

// InvoiceRecorded reports whether the ledger holds a subscription grant of
// invoiceID, whichever Event ID delivered it.
func (InvoicePaid) InvoiceRecorded(ctx context.Context, invoiceID string) (bool, error) {
	return invoiceRecorded(sqlitex.DB.WithContext(ctx), invoiceID)
}

func invoiceRecorded(db *gorm.DB, invoiceID string) (bool, error) {
	var n int64
	if err := db.Raw("SELECT count(*) FROM `credit_transactions` WHERE `type` = ? AND `stripe_invoice_id` = ?",
		typeGrantSubscription, invoiceID).Scan(&n).Error; err != nil {
		return false, fmt.Errorf("read grant of invoice %s: %w", invoiceID, err)
	}
	return n > 0, nil
}

// Subscription reads subscriptionID's row, with its stored Checkout
// association (see CheckoutCompleted.Subscription).
func (InvoicePaid) Subscription(ctx context.Context, subscriptionID string) (invoicepaid.Subscription, error) {
	db := sqlitex.DB.WithContext(ctx)
	var rows []struct {
		UserID         *string
		Classification string
		Version        int64
	}
	if err := db.Raw("SELECT `user_id`, `classification`, `version` FROM `subscriptions` WHERE `stripe_subscription_id` = ?",
		subscriptionID).Scan(&rows).Error; err != nil {
		return invoicepaid.Subscription{}, fmt.Errorf("read subscription %s: %w", subscriptionID, err)
	}
	if len(rows) == 0 {
		return invoicepaid.Subscription{}, nil
	}
	checkoutUser, err := checkoutAssociationUser(db, subscriptionID)
	if err != nil {
		return invoicepaid.Subscription{}, err
	}
	return invoicepaid.Subscription{
		Known: true, OwnerUserID: deref(rows[0].UserID), CheckoutUserID: checkoutUser,
		Classification: acceptance.Classification(rows[0].Classification), Version: rows[0].Version,
	}, nil
}

// Owner reads userID's accepted subscription, billing revision, deletion
// state, owned subscriptions and pool provenance in one read transaction. A
// user with no users row and no gate was deleted before the gate existed,
// which reads as DeletionCompleted.
func (InvoicePaid) Owner(ctx context.Context, userID string) (invoicepaid.Owner, error) {
	var o invoicepaid.Owner
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
		if o.AcceptedID, err = acceptedPointer(tx, userID); err != nil {
			return err
		}
		if o.Owned, err = ownedSubscriptions(tx, userID); err != nil {
			return err
		}
		o.Pool, err = poolProvenance(tx, userID)
		return err
	})
	if err != nil {
		return invoicepaid.Owner{}, fmt.Errorf("read invoice owner %s: %w", userID, err)
	}
	return o, nil
}

// acceptedPointer is userID's users.accepted_subscription_id, "" when none or
// no users row.
func acceptedPointer(tx *gorm.DB, userID string) (string, error) {
	var pointers []string
	if err := tx.Raw("SELECT COALESCE(`accepted_subscription_id`, '') FROM `users` WHERE `id` = ?", userID).Scan(&pointers).Error; err != nil {
		return "", fmt.Errorf("read accepted subscription pointer: %w", err)
	}
	if len(pointers) == 0 {
		return "", nil
	}
	return pointers[0], nil
}

// NormalGrantEndingAt reads the stored normal grant of subscriptionID whose
// period ends at periodEnd, nil when there is none.
func (InvoicePaid) NormalGrantEndingAt(ctx context.Context, subscriptionID string, periodEnd int64) (*creditperiod.Grant, error) {
	var rows []struct {
		StripeSubscriptionID *string
		PeriodStart          *int64
		PeriodEnd            *int64
		WithoutPeriod        bool
		Amount               int64
		Applied              *int64
	}
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT `stripe_subscription_id`, `period_start`, `period_end`, `without_period`, `amount`, `applied` "+
		"FROM `credit_transactions` WHERE `type` = ? AND `grant_kind` = ? AND `stripe_subscription_id` = ? AND `period_end` = ? "+
		"ORDER BY `created_at`, rowid LIMIT 1", typeGrantSubscription, string(invoicepaid.NormalGrant), subscriptionID, periodEnd).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read normal grant of %s: %w", subscriptionID, err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	r := rows[0]
	g := &creditperiod.Grant{
		Source:        grantSource(r.StripeSubscriptionID, r.PeriodStart, r.PeriodEnd),
		WithoutPeriod: r.WithoutPeriod,
		Applied:       r.Amount,
	}
	if r.Applied != nil {
		g.Applied = *r.Applied
	}
	return g, nil
}

// applyInvoicePaid writes e inside tx, the transaction that saves scope's
// task. It first revalidates what e.Observed read: the owner's billing
// revision and accepted pointer and the subscription row. Anything moved on is
// invoicepaid.ErrStale with nothing written. Acceptance and grants are also
// refused once the owner's deletion began, and a grant once its invoice is on
// the ledger, which another Event ID may have put there meanwhile. Every
// effect that changes the owner's acceptance or credit context moves their
// billing revision on.
func (w WebhookEffects) applyInvoicePaid(tx *gorm.DB, scope webhookevent.Scope, e invoicepaid.Effects) error {
	o := e.Observed
	revision, userExists, err := billingRevision(tx, o.OwnerUserID)
	if err != nil {
		return err
	}
	pointer, err := acceptedPointer(tx, o.OwnerUserID)
	if err != nil {
		return err
	}
	if revision != o.Revision || pointer != o.AcceptedID {
		return invoicepaid.ErrStale
	}
	sub, err := checkoutSubscriptionRow(tx, o.SubscriptionID)
	if err != nil {
		return err
	}
	if sub.Known != o.SubscriptionKnown || sub.Version != o.SubscriptionVersion {
		return invoicepaid.ErrStale
	}
	accepts := e.Classification != nil && e.Classification.To == acceptance.Accepted
	if e.Grant != nil || e.FirstPayment != nil || e.Classification != nil {
		deletion, err := deletionState(tx, o.OwnerUserID)
		if err != nil {
			return err
		}
		if !userExists || deletion != acceptance.NoDeletion {
			return invoicepaid.ErrStale
		}
	}
	now := w.now()

	if a := e.Attribution; a != nil && a.CustomerID != "" {
		// An existing Customer owner is never overwritten.
		if err := tx.Exec("INSERT INTO `stripe_customers` (`stripe_customer_id`, `user_id`, `created_at`) VALUES (?, ?, ?) "+
			"ON CONFLICT (`stripe_customer_id`) DO NOTHING", a.CustomerID, a.UserID, now.UnixMilli()).Error; err != nil {
			return fmt.Errorf("record Customer %s: %w", a.CustomerID, err)
		}
	}
	if err := saveInvoiceSubscription(tx, e, now.UnixMilli()); err != nil {
		return err
	}
	if g := e.Grant; g != nil {
		recorded, err := invoiceRecorded(tx, g.InvoiceID)
		if err != nil {
			return err
		}
		if recorded {
			return invoicepaid.ErrStale
		}
		if err := recordSubscriptionGrant(tx, scope, o.OwnerUserID, *g, now.UnixMilli()); err != nil {
			return err
		}
	}
	if userExists && (e.Attribution != nil || e.Classification != nil || e.Grant != nil) {
		set, args := "`billing_version` = `billing_version` + 1", []any{}
		if accepts {
			set += ", `accepted_subscription_id` = ?"
			args = append(args, o.SubscriptionID)
		}
		args = append(args, o.OwnerUserID, o.Revision, o.AcceptedID)
		res := tx.Exec("UPDATE `users` SET "+set+" WHERE `id` = ? AND `billing_version` = ? AND COALESCE(`accepted_subscription_id`, '') = ?", args...)
		if res.Error != nil {
			return fmt.Errorf("move billing revision on: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			return invoicepaid.ErrStale
		}
	}
	if p := e.FirstPayment; p != nil {
		return w.recordFirstPayment(tx, o.OwnerUserID, *p)
	}
	return nil
}

// saveInvoiceSubscription writes the subscription row's owner and
// classification: a new row where ENX had none, otherwise one update of the
// row at the version e observed.
func saveInvoiceSubscription(tx *gorm.DB, e invoicepaid.Effects, at int64) error {
	o := e.Observed
	var sets []string
	var args []any
	if a := e.Attribution; a != nil {
		if !o.SubscriptionKnown {
			res := tx.Exec("INSERT INTO `subscriptions` (`stripe_subscription_id`, `user_id`, `stripe_customer_id`, `status`, `created_at`, `updated_at`) "+
				"VALUES (?, ?, ?, 'none', ?, ?) ON CONFLICT (`stripe_subscription_id`) DO NOTHING", o.SubscriptionID, a.UserID, a.CustomerID, at, at)
			if res.Error != nil {
				return fmt.Errorf("create subscription %s: %w", o.SubscriptionID, res.Error)
			}
			if res.RowsAffected == 0 {
				return invoicepaid.ErrStale
			}
			o.SubscriptionKnown, o.SubscriptionVersion = true, 1
		} else {
			sets, args = append(sets, "`user_id` = ?"), append(args, a.UserID)
		}
	}
	if c := e.Classification; c != nil {
		sets, args = append(sets, "`classification` = ?"), append(args, string(c.To))
		if c.To == acceptance.Conflict {
			a := c.Alert
			sets = append(sets, "`conflict_reason` = ?", "`conflict_with_subscription_id` = ?", "`conflict_discovered_at` = ?", "`conflict_status` = ?",
				"`conflict_alert_state` = ?", "`conflict_alert_attempts` = ?", "`conflict_alert_last_error` = ?", "`conflict_alert_next_attempt_at` = ?",
				"`conflict_alert_sent_at` = ?", "`conflict_alert_claim_token` = ?", "`conflict_alert_claim_expires_at` = ?")
			args = append(args, c.ConflictReason, c.ConflictWith, unixMilliOrNil(c.DiscoveredAt), string(conflict.Open),
				string(a.State), a.Attempts, a.LastError, unixMilliOrNil(a.NextAttemptAt),
				unixMilliOrNil(a.SentAt), a.ClaimToken, unixMilliOrNil(a.ClaimExpiresAt))
		}
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, at, o.SubscriptionID, o.SubscriptionVersion)
	res := tx.Exec("UPDATE `subscriptions` SET "+strings.Join(sets, ", ")+", `version` = `version` + 1, `updated_at` = ? "+
		"WHERE `stripe_subscription_id` = ? AND `version` = ?", args...)
	if res.Error != nil {
		return fmt.Errorf("save subscription %s: %w", o.SubscriptionID, res.Error)
	}
	if res.RowsAffected == 0 {
		return invoicepaid.ErrStale
	}
	return nil
}

// recordSubscriptionGrant writes g's ledger row keyed by scope's Event ID and
// applies what reached the pool: an applied normal grant resets
// subscription_balance and points the pool at the new grant, applied upgrade
// top-up credits add to it, zero leaves the pool alone.
func recordSubscriptionGrant(tx *gorm.DB, scope webhookevent.Scope, userID string, g invoicepaid.Grant, at int64) error {
	if err := tx.Exec("INSERT INTO `credit_accounts` (`user_id`, `updated_at`) VALUES (?, ?) ON CONFLICT (`user_id`) DO NOTHING", userID, at).Error; err != nil {
		return fmt.Errorf("ensure credit account of %s: %w", userID, err)
	}
	id := uuid.New().String()
	if g.Applied > 0 {
		var err error
		switch g.Kind {
		case invoicepaid.NormalGrant:
			err = tx.Exec("UPDATE `credit_accounts` SET `subscription_balance` = ?, `period_end` = ?, `pool_grant_id` = ?, `updated_at` = ? WHERE `user_id` = ?",
				g.Applied, g.Source.Period.End, id, at, userID).Error
		case invoicepaid.UpgradeTopUp:
			err = tx.Exec("UPDATE `credit_accounts` SET `subscription_balance` = `subscription_balance` + ?, `updated_at` = ? WHERE `user_id` = ?",
				g.Applied, at, userID).Error
		default:
			err = fmt.Errorf("unknown grant kind %q", g.Kind)
		}
		if err != nil {
			return fmt.Errorf("apply grant of invoice %s: %w", g.InvoiceID, err)
		}
	}
	balance, _, err := poolBalance(tx, userID, chargerefunded.PoolSubscription)
	if err != nil {
		return err
	}
	var subscriptionID, periodStart, periodEnd, paymentIntent any
	if g.Source.SubscriptionID != "" {
		subscriptionID, periodStart, periodEnd = g.Source.SubscriptionID, g.Source.Period.Start, g.Source.Period.End
	}
	if g.PaymentIntentID != "" {
		paymentIntent = g.PaymentIntentID
	}
	if err := tx.Exec("INSERT INTO `credit_transactions` (`id`, `user_id`, `type`, `amount`, `balance_after`, `stripe_event_id`, "+
		"`stripe_payment_intent_id`, `grant_kind`, `stripe_invoice_id`, `stripe_subscription_id`, `period_start`, `period_end`, "+
		"`from_tier`, `tier`, `purchased`, `applied`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		id, userID, typeGrantSubscription, g.Applied, balance, scope.EventID, paymentIntent, string(g.Kind), g.InvoiceID,
		subscriptionID, periodStart, periodEnd, g.FromTier, g.Tier, g.Purchased, g.Applied, at).Error; err != nil {
		return fmt.Errorf("record grant of invoice %s: %w", g.InvoiceID, err)
	}
	return nil
}
