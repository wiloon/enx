package invoicepaid

import (
	"context"
	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
	"testing"
	"time"
)

type liveStripeFake struct {
	*fakeStripe
	live snapshot.Live
}

func (s liveStripeFake) Subscription(context.Context, string) (snapshot.Live, error) {
	return s.live, nil
}

type snapshotStoreFake struct{ subscription snapshot.Subscription }

func (s snapshotStoreFake) Subscription(context.Context, string) (snapshot.Subscription, error) {
	return s.subscription, nil
}

func TestLivePriceAnomalyCannotBypassPreQueryVersionCheck(t *testing.T) {
	store := &fakeStore{payload: fixture(t, "02-invoice.paid-subscription_create.json", withMetadataUser("user_1")...), subs: map[string]Subscription{sandboxSub: {Known: true, OwnerUserID: "user_1", Version: 2}}, owners: map[string]Owner{"user_1": {}}}
	stripe := liveStripeFake{fakeStripe: &fakeStripe{}, live: snapshot.Live{Live: eligibility.Live{Status: "active"}, ItemsComplete: true, PriceIDs: []string{"unknown_price"}}}
	h := NewLiveHandler(store, snapshotStoreFake{subscription: snapshot.Subscription{Known: true, Version: 1}}, stripe, plans, func() time.Time { return testNow })
	result := h.Handle(context.Background(), webhookevent.StoredTask{Scope: scope, Task: webhookevent.Task{Type: "invoice.paid", SubscriptionID: sandboxSub}})
	if result.Step != webhookevent.Transient || result.Effects != nil {
		t.Fatalf("stale live observation committed: %+v", result)
	}
}
