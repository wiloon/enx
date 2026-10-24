// Package snapshot decides a durably received event that only refreshes a
// subscription's snapshot: invoice.payment_failed, invoice.voided,
// customer.subscription.updated/deleted/pending_update_applied/
// pending_update_expired and subscription_schedule.* (ADR-067
// §积分随 Stripe 事件调整). Such an event never grants or deducts credits,
// never classifies or accepts a subscription and never moves an owner's
// accepted pointer.
//
// Stripe does not deliver events in order, so Handler records the
// subscription's live Stripe state rather than the payload's: a late event
// cannot regress the snapshot. It reads the store and Stripe outside any
// database transaction and writes nothing: the refresh goes out as Effects,
// which the worker's task store commits with the task's next state under its
// claim, after revalidating the row version Effects observed.
package snapshot

import (
	"context"

	"enx-api/billing/eligibility"
	"enx-api/billing/webhookevent"
)

// Reasons this package adds.
const (
	// ReasonNoSubscription: the event names no subscription, such as a
	// one-off invoice's failed payment; there is no snapshot to refresh.
	ReasonNoSubscription = "no_subscription"
	// ReasonUnknownPrice: the subscription's item is on a Price outside ENX's
	// configured tier Prices, such as a Dashboard mistake. Nothing changes
	// and ENX does not revert it in Stripe.
	ReasonUnknownPrice = "unknown_subscription_price"
	// ReasonAmbiguousItems: the subscription has no item, several items, or
	// more items than Stripe returned; ENX subscriptions have exactly one.
	ReasonAmbiguousItems = "ambiguous_subscription_items"
)

// Live is a subscription's live Stripe state.
type Live struct {
	eligibility.Live
	// PriceIDs are the Prices of the subscription's items, in Stripe's order.
	PriceIDs []string
	// ItemsComplete is false when Stripe has more items than it returned.
	ItemsComplete bool
}

// Subscription is ENX's record of a Stripe subscription. Known is false when
// ENX has no row for it yet.
type Subscription struct {
	Known bool
	// Version changes on every write to the row.
	Version int64
}

// Store reads ENX's subscription records.
type Store interface {
	Subscription(ctx context.Context, subscriptionID string) (Subscription, error)
}

// Stripe reads live Stripe state.
type Stripe interface {
	Subscription(ctx context.Context, subscriptionID string) (Live, error)
}

// Effects refresh one subscription's snapshot. Save applies them only while
// the row is still at Version, or still absent when Known is false; a row
// ENX had none of is created with no owner and no classification. Otherwise
// it changes nothing and the worker retries.
type Effects struct {
	SubscriptionID string
	Known          bool
	Version        int64
	// State is the live Stripe state: status, scheduled cancellation, current
	// period end, pending update and attached schedule.
	State eligibility.Live
	// PriceID is the item's current Price and Tier its configured tier: the
	// subscription's effective tier.
	PriceID string
	Tier    string
}

// Handler decides snapshot events.
type Handler struct {
	store        Store
	stripe       Stripe
	tierForPrice map[string]string
}

// NewHandler returns a handler. tierForPrice maps each configured tier Price
// ID to its tier.
func NewHandler(store Store, stripe Stripe, tierForPrice map[string]string) *Handler {
	return &Handler{store: store, stripe: stripe, tierForPrice: tierForPrice}
}

// Handle decides one snapshot event from the Subscription ID receipt parsed.
// An event naming no subscription has no effect. A subscription whose one
// item ENX cannot map to a configured tier needs attention with nothing
// changed. Otherwise the snapshot takes the live Stripe state, whatever the
// subscription's owner, classification or the owner's deletion gate: it is
// financial context, and no entitlement follows from it here.
func (h *Handler) Handle(ctx context.Context, s webhookevent.StoredTask) webhookevent.Result {
	id := s.Task.SubscriptionID
	if id == "" {
		return webhookevent.Result{Step: webhookevent.NoEffect, Reason: ReasonNoSubscription}
	}
	sub, err := h.store.Subscription(ctx, id)
	if err != nil {
		return transient(err)
	}
	live, err := h.stripe.Subscription(ctx, id)
	if err != nil {
		return transient(err)
	}
	if !live.ItemsComplete || len(live.PriceIDs) != 1 {
		return webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: ReasonAmbiguousItems}
	}
	priceID := live.PriceIDs[0]
	tier, ok := h.tierForPrice[priceID]
	if !ok {
		return webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: ReasonUnknownPrice}
	}
	return webhookevent.Result{Step: webhookevent.Handled, Effects: Effects{
		SubscriptionID: id, Known: sub.Known, Version: sub.Version,
		State: live.Live, PriceID: priceID, Tier: tier,
	}}
}

func transient(err error) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Transient, Reason: err.Error()}
}
