package deletion

import (
	"context"
	"errors"
	"testing"

	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
)

type fakeStore struct {
	owned []eligibility.Owned
	err   error
}

func (f fakeStore) OwnedSubscriptions(context.Context, string) ([]eligibility.Owned, error) {
	return f.owned, f.err
}

type fakeStripe struct {
	live  map[string]eligibility.Live
	err   map[string]error
	asked []string
}

func (f *fakeStripe) Subscription(_ context.Context, id string) (snapshot.Live, error) {
	f.asked = append(f.asked, id)
	if err := f.err[id]; err != nil {
		return snapshot.Live{}, err
	}
	return snapshot.Live{Live: f.live[id]}, nil
}

func TestACanceledPortalSubscriptionInFlexibleBillingModeDoesNotBlockDeletion(t *testing.T) {
	// Sandbox shape of sub_1UTuL3D98PEpzR2EQHPLYoEZ (2026-10-23).
	stripe := &fakeStripe{live: map[string]eligibility.Live{
		"sub_1": {Status: "active", CancelAt: 1795485941, CurrentPeriodEnd: 1795485941},
	}}
	store := fakeStore{owned: []eligibility.Owned{{ID: "sub_1", StoredStatus: "active"}}}

	got, err := New(store, stripe).Check(context.Background(), "user_1")

	if err != nil || got != eligibility.DeletionAllowed {
		t.Errorf("Check = %v, %v; want DeletionAllowed", got, err)
	}
}

func TestACancellationAfterThePeriodEndStillBlocksAsRenewing(t *testing.T) {
	stripe := &fakeStripe{live: map[string]eligibility.Live{
		"sub_1": {Status: "active", CancelAt: 1795485942, CurrentPeriodEnd: 1795485941},
	}}
	store := fakeStore{owned: []eligibility.Owned{{ID: "sub_1", StoredStatus: "active"}}}

	got, err := New(store, stripe).Check(context.Background(), "user_1")

	if err != nil || got != eligibility.DeletionBlockedRenewing {
		t.Errorf("Check = %v, %v; want DeletionBlockedRenewing", got, err)
	}
}

func TestAStoredTerminalSubscriptionIsNotLookedUp(t *testing.T) {
	stripe := &fakeStripe{err: map[string]error{"sub_1": errors.New("must not be called"), "sub_2": errors.New("must not be called")}}
	store := fakeStore{owned: []eligibility.Owned{
		{ID: "sub_1", StoredStatus: "canceled"},
		{ID: "sub_2", StoredStatus: "incomplete_expired"},
	}}

	got, err := New(store, stripe).Check(context.Background(), "user_1")

	if err != nil || got != eligibility.DeletionAllowed {
		t.Errorf("Check = %v, %v; want DeletionAllowed", got, err)
	}
	if len(stripe.asked) != 0 {
		t.Errorf("Stripe was asked about %v, want no calls", stripe.asked)
	}
}

func TestAFailedLookupBlocksAsUnknownNeverAsEnded(t *testing.T) {
	stripe := &fakeStripe{err: map[string]error{"sub_1": errors.New("resource_missing")}}
	store := fakeStore{owned: []eligibility.Owned{{ID: "sub_1", StoredStatus: "active"}}}

	got, err := New(store, stripe).Check(context.Background(), "user_1")

	if err != nil || got != eligibility.DeletionBlockedLookup {
		t.Errorf("Check = %v, %v; want DeletionBlockedLookup", got, err)
	}
}

func TestAStoreErrorIsAnErrorAndStripeIsNotCalled(t *testing.T) {
	stripe := &fakeStripe{}
	storeErr := errors.New("database is locked")

	_, err := New(fakeStore{err: storeErr}, stripe).Check(context.Background(), "user_1")

	if !errors.Is(err, storeErr) {
		t.Errorf("Check error = %v, want it to wrap %v", err, storeErr)
	}
	if len(stripe.asked) != 0 {
		t.Errorf("Stripe was asked about %v, want no calls", stripe.asked)
	}
}
