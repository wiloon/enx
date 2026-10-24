// Package chargerefunded decides a durably received charge.refunded event
// (ADR-049 Decisions 7 and 8, ADR-067 §积分周期与退款来源). It finds the
// grant the refunded payment bought through its PaymentIntent, claws back
// the cumulative proportional share of it, and ends the subscription that
// grant paid for. It never guesses the grant or the subscription from the
// owner's current accepted pointer: a refund of a historical or unapplied
// grant takes nothing from the pool and never cancels another subscription.
//
// Handler reads the store and Stripe outside any database transaction and
// writes no ENX record: the clawback goes out as Effects, which the
// worker's task store commits with the task's next state under its claim,
// after revalidating what Effects.Observed says was read. The only external
// action is the Stripe cancellation, which is idempotent.
package chargerefunded

import (
	"context"
	"errors"

	"enx-api/billing/acceptance"
	"enx-api/billing/creditperiod"
	"enx-api/billing/webhookevent"
)

// Reasons this package adds to the ones of the rules it applies.
const (
	// ReasonMalformedCharge: the payload of a supported version is not a
	// charge with a valid cumulative refund.
	ReasonMalformedCharge = "malformed_refunded_charge"
	// ReasonRefundWithoutPaymentIntent: the charge has no PaymentIntent, so
	// no grant can ever match it.
	ReasonRefundWithoutPaymentIntent = "refund_without_payment_intent"
	// ReasonRefundGrantMissing: no grant records the refunded PaymentIntent
	// yet. The refund may precede its grant, so it waits; at the deadline it
	// needs attention as an unmatched refund.
	ReasonRefundGrantMissing = "refund_grant_missing"
	// ReasonRefundedSubscriptionUnknown: the refunded subscription grant is an
	// old ledger grant with no recorded subscription, so ENX cannot tell
	// which subscription to end and never guesses one.
	ReasonRefundedSubscriptionUnknown = "refunded_subscription_unknown"
	// ReasonDeletionInProgress: the owner's account deletion is in progress;
	// decide again once it completes or aborts.
	ReasonDeletionInProgress = "deletion_in_progress"
	// ReasonCancellationPending: the clawback is recorded, but ending the
	// refunded subscription in Stripe failed; retry only the cancellation.
	ReasonCancellationPending = "subscription_cancellation_pending"
)

// Pool is the credit pool a grant went into.
type Pool string

const (
	PoolTopUp        Pool = "topup"
	PoolSubscription Pool = "subscription"
)

// Grant is the stored grant a PaymentIntent paid for: a top-up, a normal
// period grant or upgrade top-up credits.
type Grant struct {
	// ID is the grant's ledger row; clawbacks link to it.
	ID     string
	UserID string
	Pool   Pool
	// Credits is what a top-up granted. Subscription grants use Period.
	Credits int64
	// Period is a subscription grant's provenance: its subscription and
	// period, and what it actually put into the pool.
	Period creditperiod.Grant
	// Taken is what earlier clawbacks of this grant took.
	Taken int64
}

// Owner is the billing state of the grant's owner.
type Owner struct {
	// Revision is the owner's billing revision; every change to the pool's
	// provenance changes it.
	Revision int64
	Deletion acceptance.Deletion
	// Pool is where today's subscription_balance came from.
	Pool                creditperiod.Pool
	SubscriptionBalance int64
}

// Store reads ENX's billing records. None of the reads needs a lock: Save
// revalidates Effects.Observed before it applies anything.
type Store interface {
	// Payload is the event's original payload.
	Payload(ctx context.Context, scope webhookevent.Scope) ([]byte, error)
	// GrantForPaymentIntent is the grant the PaymentIntent paid for; found is
	// false when none is recorded yet.
	GrantForPaymentIntent(ctx context.Context, paymentIntentID string) (g Grant, found bool, err error)
	// ClawbackRecorded reports whether this event's clawback is already
	// recorded, by an earlier attempt whose cancellation failed.
	ClawbackRecorded(ctx context.Context, scope webhookevent.Scope) (bool, error)
	Owner(ctx context.Context, userID string) (Owner, error)
}

// Stripe reads and ends subscriptions in Stripe.
type Stripe interface {
	SubscriptionStatus(ctx context.Context, subscriptionID string) (string, error)
	// CancelSubscriptionNow ends the subscription at once, with no proration
	// and no final invoice; one already gone counts as done.
	CancelSubscriptionNow(ctx context.Context, subscriptionID string) error
}

// Observed is what a decision read. Save applies the Effects only while the
// owner's billing revision, the grant's clawback total and, for a clawback
// from the subscription pool, the subscription balance are still these;
// otherwise it changes nothing and the worker retries.
type Observed struct {
	UserID              string
	Revision            int64
	GrantID             string
	Taken               int64
	SubscriptionBalance int64
}

// Clawback takes Credits (zero or more) from the grant's pool and records a
// CLAWBACK ledger row linked to the grant, unique per scoped Event ID, even
// when it takes nothing. A top-up pool may go negative (ADR-049).
type Clawback struct {
	GrantID string
	UserID  string
	Pool    Pool
	Credits int64
	// ChargeID and the cumulative amounts name the refund on the ledger
	// row's note.
	ChargeID string
	Refunded int64
	Captured int64
}

// Effects are the local changes a decided refund commits with its task.
type Effects struct {
	Observed Observed
	Clawback *Clawback
}

// Handler decides charge.refunded events.
type Handler struct {
	store  Store
	stripe Stripe
}

// NewHandler returns a handler.
func NewHandler(store Store, stripe Stripe) *Handler {
	return &Handler{store: store, stripe: stripe}
}

// Handle decides one charge.refunded event. A charge ENX cannot read, or
// one no PaymentIntent created, needs attention. A refund whose grant is not
// recorded yet waits for it. Otherwise the clawback is decided once per
// Event ID: a top-up's cumulative proportional share (its pool may go
// negative), or a subscription grant's share as creditperiod.Clawback
// allows. While the owner's deletion is in progress the refund waits; after
// it the clawback is recorded with nothing taken. Clawback first, then
// cancellation (ADR-049 Decision 8): a subscription grant's own
// subscription is ended in Stripe while it is still live; when that fails,
// the clawback commits with a retry that only cancels. A grant whose credits
// need investigation takes nothing, but its known subscription is still
// ended, with retries, before the refund needs attention.
func (h *Handler) Handle(ctx context.Context, s webhookevent.StoredTask) webhookevent.Result {
	payload, err := h.store.Payload(ctx, s.Scope)
	if err != nil {
		return transient(err)
	}
	ch, err := DecodeEvent(payload)
	switch {
	case errors.Is(err, ErrUnsupportedAPIVersion):
		return unrecoverable(webhookevent.ReasonUnsupportedAPIVersion, nil)
	case err != nil:
		return unrecoverable(ReasonMalformedCharge, nil)
	}
	if ch.PaymentIntentID == "" {
		return unrecoverable(ReasonRefundWithoutPaymentIntent, nil)
	}
	grant, found, err := h.store.GrantForPaymentIntent(ctx, ch.PaymentIntentID)
	if err != nil {
		return transient(err)
	}
	if !found {
		return webhookevent.Result{Step: webhookevent.MissingDependency, Reason: ReasonRefundGrantMissing}
	}
	recorded, err := h.store.ClawbackRecorded(ctx, s.Scope)
	if err != nil {
		return transient(err)
	}

	var effects any
	done := webhookevent.Result{Step: webhookevent.Handled}
	if !recorded {
		e, result, outcome := h.clawback(ctx, ch, grant)
		switch outcome {
		case clawbackDecided:
			effects = e
			done.Effects = e
		case clawbackNeedsAttention:
			done = result
		default:
			return result
		}
	}

	if grant.Pool != PoolSubscription {
		return done
	}
	subscriptionID := grant.Period.Source.SubscriptionID
	if subscriptionID == "" {
		if done.Step == webhookevent.Unrecoverable {
			return done
		}
		return unrecoverable(ReasonRefundedSubscriptionUnknown, effects)
	}
	if err := h.cancel(ctx, subscriptionID); err != nil {
		return webhookevent.Result{Step: webhookevent.Transient, Reason: ReasonCancellationPending + ": " + err.Error(), Effects: effects}
	}
	return done
}

type clawbackOutcome int

const (
	// clawbackDecided: the Effects say what the refund takes.
	clawbackDecided clawbackOutcome = iota
	// clawbackStopped: the refund cannot be decided now; the result says why.
	clawbackStopped
	// clawbackNeedsAttention: the credits need investigation and nothing is
	// taken on a guess, but the refunded subscription is still ended first.
	clawbackNeedsAttention
)

// clawback decides what the refund takes from grant.
func (h *Handler) clawback(ctx context.Context, ch Charge, grant Grant) (e Effects, result webhookevent.Result, outcome clawbackOutcome) {
	owner, err := h.store.Owner(ctx, grant.UserID)
	if err != nil {
		return Effects{}, transient(err), clawbackStopped
	}
	if owner.Deletion == acceptance.DeletionInProgress {
		return Effects{}, webhookevent.Result{Step: webhookevent.MissingDependency, Reason: ReasonDeletionInProgress}, clawbackStopped
	}
	e = Effects{
		Observed: Observed{UserID: grant.UserID, Revision: owner.Revision, GrantID: grant.ID, Taken: grant.Taken},
		Clawback: &Clawback{
			GrantID: grant.ID, UserID: grant.UserID, Pool: grant.Pool,
			ChargeID: ch.ID, Refunded: ch.Refunded, Captured: ch.Captured,
		},
	}
	// After deletion the refund is financial audit only: no balance exists
	// to take from, and none is recreated.
	if owner.Deletion == acceptance.DeletionCompleted {
		return e, webhookevent.Result{}, clawbackDecided
	}

	if grant.Pool != PoolSubscription {
		e.Clawback.Credits = max(grant.Credits*ch.Refunded/ch.Captured-grant.Taken, 0)
		return e, webhookevent.Result{}, clawbackDecided
	}
	effect, err := creditperiod.Clawback(owner.Pool, grant.Period, creditperiod.Refund{
		Refunded: ch.Refunded, Captured: ch.Captured, AlreadyTaken: grant.Taken, Balance: owner.SubscriptionBalance,
	})
	if err != nil {
		return Effects{}, unrecoverable(ReasonMalformedCharge, nil), clawbackStopped
	}
	switch effect.Outcome {
	case creditperiod.WaitDependency:
		return Effects{}, webhookevent.Result{Step: webhookevent.MissingDependency, Reason: effect.Reason}, clawbackStopped
	case creditperiod.NeedsAttention:
		return Effects{}, unrecoverable(effect.Reason, nil), clawbackNeedsAttention
	}
	e.Observed.SubscriptionBalance = owner.SubscriptionBalance
	e.Clawback.Credits = effect.Credits
	return e, webhookevent.Result{}, clawbackDecided
}

// cancel ends the refunded subscription in Stripe while its live status is
// active, trialing or past_due (ADR-049 Decision 8); any other status is
// left alone.
func (h *Handler) cancel(ctx context.Context, subscriptionID string) error {
	status, err := h.stripe.SubscriptionStatus(ctx, subscriptionID)
	if err != nil {
		return err
	}
	switch status {
	case "active", "trialing", "past_due":
		return h.stripe.CancelSubscriptionNow(ctx, subscriptionID)
	}
	return nil
}

func transient(err error) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Transient, Reason: err.Error()}
}

// unrecoverable needs attention, committing effects (nil for none) with it.
func unrecoverable(reason string, effects any) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: reason, Effects: effects}
}
