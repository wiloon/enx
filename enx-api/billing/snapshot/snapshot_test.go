package snapshot

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/eligibility"
	"enx-api/billing/webhookevent"
)

// Sandbox objects in billing/testdata/stripe-plan-change.
const (
	pricePro        = "price_1UTxL2D98PEpzR2E1f73d4Ln"
	priceProPlus    = "price_1UTxL2D98PEpzR2E4lt7hGCN"
	priceMax        = "price_1UTxL2D98PEpzR2EokCgl4jd"
	sandboxSub      = "sub_1UU03ID98PEpzR2EJ2kjpqD1"
	sandboxCustomer = "cus_VV03wKkovxzzTP"
)

var testTime = time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)

var tierForPrice = map[string]string{pricePro: "pro", priceProPlus: "pro-plus", priceMax: "max"}

type fakeStore struct {
	subs  map[string]Subscription
	err   error
	calls int
}

func (f *fakeStore) Subscription(_ context.Context, id string) (Subscription, error) {
	f.calls++
	return f.subs[id], f.err
}

type fakeStripe struct {
	live  map[string]Live
	err   error
	calls int
}

func (f *fakeStripe) Subscription(_ context.Context, id string) (Live, error) {
	f.calls++
	if f.err != nil {
		return Live{}, f.err
	}
	live, ok := f.live[id]
	if !ok {
		return Live{}, errors.New("no live state for " + id)
	}
	return live, nil
}

func task(eventType, subscriptionID string) webhookevent.StoredTask {
	return webhookevent.StoredTask{
		Scope:      webhookevent.Scope{AccountID: "acct_1", EventID: "evt_test"},
		APIVersion: "2026-07-29.dahlia",
		Task:       webhookevent.NewTask(eventType, subscriptionID, testTime),
	}
}

// liveOn is an active subscription with one item on priceID.
func liveOn(priceID string, state eligibility.Live) Live {
	if state.Status == "" {
		state.Status = "active"
	}
	return Live{Live: state, PriceIDs: []string{priceID}, ItemsComplete: true}
}

func TestSnapshotRecordsTheLiveStripeStateAndTheItemsTier(t *testing.T) {
	// A Portal downgrade scheduled at period end, read after the upgrade to
	// Max was applied: the snapshot is Stripe's state now, whichever event
	// carried the news.
	state := eligibility.Live{Status: "active", CurrentPeriodEnd: 1795507901, HasSchedule: true}
	store := &fakeStore{subs: map[string]Subscription{sandboxSub: {Known: true, Version: 7}}}
	live := liveOn(priceMax, state)
	live.CustomerID = sandboxCustomer
	stripe := &fakeStripe{live: map[string]Live{sandboxSub: live}}

	got := NewHandler(store, stripe, tierForPrice).Handle(context.Background(), task("subscription_schedule.created", sandboxSub))

	want := webhookevent.Result{Step: webhookevent.Handled, Effects: Effects{
		SubscriptionID: sandboxSub, Known: true, Version: 7, CustomerID: sandboxCustomer,
		State: state, PriceID: priceMax, Tier: "max",
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Handle = %+v, want %+v", got, want)
	}
}

func TestSnapshotRecordsPendingUpdatesAndScheduledCancellations(t *testing.T) {
	cases := []struct {
		name      string
		eventType string
		state     eligibility.Live
	}{
		{"a declined upgrade waits for payment", "invoice.payment_failed",
			eligibility.Live{Status: "active", CurrentPeriodEnd: 1795507901, PendingUpdate: true}},
		{"a Portal cancellation sets only cancel_at", "customer.subscription.updated",
			eligibility.Live{Status: "active", CurrentPeriodEnd: 1795507901, CancelAt: 1795507901}},
		{"a deleted subscription ended", "customer.subscription.deleted",
			eligibility.Live{Status: "canceled", CurrentPeriodEnd: 1795507901}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{subs: map[string]Subscription{sandboxSub: {Known: true, Version: 3}}}
			stripe := &fakeStripe{live: map[string]Live{sandboxSub: liveOn(pricePro, tc.state)}}

			got := NewHandler(store, stripe, tierForPrice).Handle(context.Background(), task(tc.eventType, sandboxSub))

			e, ok := got.Effects.(Effects)
			if got.Step != webhookevent.Handled || !ok {
				t.Fatalf("Handle = %+v, want handled with snapshot effects", got)
			}
			if e.State != tc.state || e.Tier != "pro" {
				t.Errorf("snapshot = %+v on tier %q, want %+v on pro", e.State, e.Tier, tc.state)
			}
		})
	}
}

func TestSnapshotOfASubscriptionENXHasNoRowYetRecordsItUnattributed(t *testing.T) {
	// subscription-before-checkout: the row is created with no owner; the
	// Checkout or a paid invoice attributes it later.
	store := &fakeStore{subs: map[string]Subscription{}}
	stripe := &fakeStripe{live: map[string]Live{sandboxSub: liveOn(pricePro, eligibility.Live{CurrentPeriodEnd: 1795507901})}}

	got := NewHandler(store, stripe, tierForPrice).Handle(context.Background(), task("customer.subscription.updated", sandboxSub))

	e, ok := got.Effects.(Effects)
	if got.Step != webhookevent.Handled || !ok {
		t.Fatalf("Handle = %+v, want handled with snapshot effects", got)
	}
	if e.Known || e.Version != 0 || e.SubscriptionID != sandboxSub {
		t.Errorf("effects observe %s known=%v version=%d, want %s absent at version 0", e.SubscriptionID, e.Known, e.Version, sandboxSub)
	}
}

func TestEventNamingNoSubscriptionHasNoEffect(t *testing.T) {
	// A one-off invoice's failed payment, or a schedule never attached to a
	// subscription.
	store, stripe := &fakeStore{}, &fakeStripe{}

	got := NewHandler(store, stripe, tierForPrice).Handle(context.Background(), task("invoice.payment_failed", ""))

	want := webhookevent.Result{Step: webhookevent.NoEffect, Reason: ReasonNoSubscription}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Handle = %+v, want %+v", got, want)
	}
	if store.calls+stripe.calls != 0 {
		t.Errorf("made %d store and %d Stripe calls, want none", store.calls, stripe.calls)
	}
}

func TestSubscriptionItemsENXCannotReadNeedAttentionAndChangeNothing(t *testing.T) {
	cases := []struct {
		name   string
		live   Live
		reason string
	}{
		{"a Price outside the tier Prices", Live{Live: eligibility.Live{Status: "active"}, PriceIDs: []string{"price_dashboard_mistake"}, ItemsComplete: true}, ReasonUnknownPrice},
		{"two items", Live{Live: eligibility.Live{Status: "active"}, PriceIDs: []string{pricePro, priceMax}, ItemsComplete: true}, ReasonAmbiguousItems},
		{"no item", Live{Live: eligibility.Live{Status: "active"}, ItemsComplete: true}, ReasonAmbiguousItems},
		{"more items than Stripe returned", Live{Live: eligibility.Live{Status: "active"}, PriceIDs: []string{pricePro}}, ReasonAmbiguousItems},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{subs: map[string]Subscription{sandboxSub: {Known: true, Version: 2}}}
			stripe := &fakeStripe{live: map[string]Live{sandboxSub: tc.live}}

			got := NewHandler(store, stripe, tierForPrice).Handle(context.Background(), task("customer.subscription.updated", sandboxSub))

			want := webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: tc.reason}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("Handle = %+v, want %+v", got, want)
			}
		})
	}
}

func TestSnapshotFailuresRetryWithoutEffects(t *testing.T) {
	cases := []struct {
		name   string
		store  *fakeStore
		stripe *fakeStripe
	}{
		{"store failure", &fakeStore{err: errors.New("database is locked")},
			&fakeStripe{live: map[string]Live{sandboxSub: liveOn(pricePro, eligibility.Live{})}}},
		{"Stripe failure", &fakeStore{subs: map[string]Subscription{sandboxSub: {Known: true, Version: 1}}},
			&fakeStripe{err: errors.New("stripe: 500")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NewHandler(tc.store, tc.stripe, tierForPrice).Handle(context.Background(), task("customer.subscription.updated", sandboxSub))

			if got.Step != webhookevent.Transient || got.Effects != nil || got.Reason == "" {
				t.Errorf("Handle = %+v, want a transient result with its error and no effects", got)
			}
		})
	}
}
