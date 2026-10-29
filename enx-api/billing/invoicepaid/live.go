package invoicepaid

import (
	"context"
	"time"

	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
)

// LiveStripe reads a complete subscription snapshot as well as invoice payment data.
type LiveStripe interface {
	Stripe
	snapshot.Stripe
}

// LiveEffects commits a payment decision and its observed live snapshot together.
type LiveEffects struct {
	Invoice  Effects
	Snapshot snapshot.Effects
}

// LiveHandler uses the same Stripe observation for acceptance and snapshot refresh.
type LiveHandler struct {
	store     Store
	snapshots snapshot.Store
	stripe    LiveStripe
	plans     Plans
	now       func() time.Time
}

func NewLiveHandler(store Store, snapshots snapshot.Store, stripe LiveStripe, plans Plans, now func() time.Time) *LiveHandler {
	return &LiveHandler{store: store, snapshots: snapshots, stripe: stripe, plans: plans, now: now}
}

// observedStripe is scoped to one event; other subscriptions still use live reads.
type observedStripe struct {
	LiveStripe
	id   string
	live snapshot.Live
}

func (s observedStripe) SubscriptionStatus(ctx context.Context, id string) (string, error) {
	if id == s.id {
		return s.live.Status, nil
	}
	return s.LiveStripe.SubscriptionStatus(ctx, id)
}

func (s observedStripe) Subscription(ctx context.Context, id string) (snapshot.Live, error) {
	if id == s.id {
		return s.live, nil
	}
	return s.LiveStripe.Subscription(ctx, id)
}

// observedSnapshotStore keeps the version read before the remote request.
type observedSnapshotStore struct {
	snapshot.Store
	id           string
	subscription snapshot.Subscription
}

func (s observedSnapshotStore) Subscription(ctx context.Context, id string) (snapshot.Subscription, error) {
	if id == s.id {
		return s.subscription, nil
	}
	return s.Store.Subscription(ctx, id)
}

func (h *LiveHandler) Handle(ctx context.Context, task webhookevent.StoredTask) webhookevent.Result {
	if task.Task.SubscriptionID == "" {
		return NewHandler(h.store, h.stripe, h.plans, h.now).Handle(ctx, task)
	}
	before, err := h.snapshots.Subscription(ctx, task.Task.SubscriptionID)
	if err != nil {
		return transient(err)
	}
	live, err := h.stripe.Subscription(ctx, task.Task.SubscriptionID)
	if err != nil {
		return transient(err)
	}
	observed := observedStripe{LiveStripe: h.stripe, id: task.Task.SubscriptionID, live: live}
	result := NewHandler(h.store, observed, h.plans, h.now).Handle(ctx, task)
	effects, hasInvoice := result.Effects.(Effects)
	if hasInvoice && (before.Known != effects.Observed.SubscriptionKnown || before.Version != effects.Observed.SubscriptionVersion) {
		return transient(ErrStale)
	}
	if result.Step != webhookevent.Handled && !hasInvoice {
		return result
	}
	refreshed := snapshot.NewHandler(observedSnapshotStore{Store: h.snapshots, id: task.Task.SubscriptionID, subscription: before}, observed, h.plans.TierForPrice).Handle(ctx, task)
	if refreshed.Step != webhookevent.Handled {
		if refreshed.Step == webhookevent.Unrecoverable && hasInvoice {
			// Snapshot anomalies must not erase verified ownership or conflicts.
			// Grants wait for an administrator to resolve the snapshot anomaly.
			effects.Grant, effects.FirstPayment = nil, nil
			refreshed.Effects = effects
		}
		return refreshed
	}
	s := refreshed.Effects.(snapshot.Effects)
	if !hasInvoice {
		result.Effects = s
		return result
	}
	result.Effects = LiveEffects{Invoice: effects, Snapshot: s}
	return result
}
