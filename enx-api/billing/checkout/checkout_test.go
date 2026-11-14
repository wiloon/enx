package checkout

import (
	"context"
	"errors"
	"testing"

	"enx-api/billing/acceptance"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
)

type fakeStore struct {
	owner portalsession.Owner
	err   error
}

func (f fakeStore) Owner(context.Context, string) (portalsession.Owner, error) {
	return f.owner, f.err
}

// fakeStripe answers live subscription reads from subs; an ID missing from
// subs fails like a Stripe outage.
type fakeStripe struct {
	subs map[string]portalsession.Subscription
}

func (f fakeStripe) Subscription(_ context.Context, id string) (portalsession.Subscription, error) {
	sub, ok := f.subs[id]
	if !ok {
		return portalsession.Subscription{}, errors.New("stripe unavailable")
	}
	return sub, nil
}

func live(status string) portalsession.Subscription {
	return portalsession.Subscription{Live: eligibility.Live{Status: status}}
}

func prepare(t *testing.T, owner portalsession.Owner, stripe fakeStripe, tier string) (string, error) {
	t.Helper()
	return New(fakeStore{owner: owner}, stripe).Prepare(context.Background(), "u-1", tier)
}

func TestSubscriptionCheckoutIsRefusedWhileTheAccountIsBeingDeleted(t *testing.T) {
	_, err := prepare(t, portalsession.Owner{Deletion: acceptance.DeletionInProgress, CustomerID: "cus_1"}, fakeStripe{}, "pro")

	var refusal *Refusal
	if !errors.As(err, &refusal) || refusal.Reason != eligibility.ReasonDeletionInProgress {
		t.Fatalf("err = %v, want a deletion_in_progress Refusal", err)
	}
	if !errors.Is(err, ErrRefused) {
		t.Fatalf("a Refusal must match ErrRefused: %v", err)
	}
}

func TestSubscriptionCheckoutReportsTheDeletionBeforeAConflict(t *testing.T) {
	owner := portalsession.Owner{Deletion: acceptance.DeletionInProgress, CustomerID: "cus_1", Owned: []eligibility.Owned{
		{ID: "sub_a", Conflict: eligibility.ConflictOpen, StoredStatus: "active"},
	}}
	_, err := prepare(t, owner, fakeStripe{}, "pro")

	var refusal *Refusal
	if !errors.As(err, &refusal) || refusal.Reason != eligibility.ReasonDeletionInProgress || refusal.SubscriptionID != "" {
		t.Fatalf("err = %v, want a deletion_in_progress Refusal naming no subscription", err)
	}
}

func TestSubscriptionCheckoutIsRefusedByAnOpenConflict(t *testing.T) {
	owner := portalsession.Owner{CustomerID: "cus_1", Owned: []eligibility.Owned{
		{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "active"},
		{ID: "sub_a", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"},
	}}
	_, err := prepare(t, owner, fakeStripe{}, "pro")

	var refusal *Refusal
	if !errors.As(err, &refusal) {
		t.Fatalf("err = %v, want a Refusal", err)
	}
	if refusal.Reason != eligibility.ReasonSubscriptionConflict || refusal.SubscriptionID != "sub_a" {
		t.Fatalf("refusal = %+v, want subscription_conflict on sub_a", refusal)
	}
}

func TestSubscriptionCheckoutChecksAResolvedConflictAgainstLiveStripe(t *testing.T) {
	owner := portalsession.Owner{CustomerID: "cus_1", Owned: []eligibility.Owned{
		{ID: "sub_old", Conflict: eligibility.ConflictResolved, StoredStatus: "active"},
	}}

	t.Run("still billable blocks", func(t *testing.T) {
		_, err := prepare(t, owner, fakeStripe{subs: map[string]portalsession.Subscription{"sub_old": live("past_due")}}, "pro")
		var refusal *Refusal
		if !errors.As(err, &refusal) || refusal.SubscriptionID != "sub_old" {
			t.Fatalf("err = %v, want a Refusal on sub_old", err)
		}
	})
	t.Run("ended in Stripe allows", func(t *testing.T) {
		customer, err := prepare(t, owner, fakeStripe{subs: map[string]portalsession.Subscription{"sub_old": live("canceled")}}, "pro")
		if err != nil || customer != "cus_1" {
			t.Fatalf("Prepare = %q, %v; want cus_1", customer, err)
		}
	})
	t.Run("unreadable fails closed", func(t *testing.T) {
		customer, err := prepare(t, owner, fakeStripe{}, "pro")
		if !errors.Is(err, eligibility.ErrLiveStateUnknown) || customer != "" {
			t.Fatalf("Prepare = %q, %v; want ErrLiveStateUnknown", customer, err)
		}
		if errors.Is(err, ErrRefused) {
			t.Fatal("an unknown live state is retryable, not a refusal")
		}
	})
}

func TestPrepareDoesNotWriteLiveStateIntoTheStoreOwner(t *testing.T) {
	owner := portalsession.Owner{CustomerID: "cus_1", Owned: []eligibility.Owned{
		{ID: "sub_old", Conflict: eligibility.ConflictResolved, StoredStatus: "active"},
	}}

	customer, err := prepare(t, owner, fakeStripe{subs: map[string]portalsession.Subscription{"sub_old": live("canceled")}}, "pro")
	if err != nil || customer != "cus_1" {
		t.Fatalf("first Prepare = %q, %v; want cus_1", customer, err)
	}

	customer, err = prepare(t, owner, fakeStripe{}, "pro")
	if !errors.Is(err, eligibility.ErrLiveStateUnknown) || customer != "" {
		t.Fatalf("second Prepare = %q, %v; want ErrLiveStateUnknown", customer, err)
	}
}

func TestSubscriptionCheckoutIsRefusedForAnActiveSubscriber(t *testing.T) {
	owner := portalsession.Owner{AcceptedID: "sub_live", AcceptedCustomerID: "cus_acc", CustomerID: "cus_1"}
	_, err := prepare(t, owner, fakeStripe{subs: map[string]portalsession.Subscription{"sub_live": live("active")}}, "max")

	if !errors.Is(err, ErrRefused) {
		t.Fatalf("err = %v, want ErrRefused", err)
	}
	var refusal *Refusal
	if errors.As(err, &refusal) {
		t.Fatalf("an existing subscription is a plain ErrRefused, not a blocking Refusal: %+v", refusal)
	}
}

func TestSubscriptionCheckoutRetriesAnIndeterminateResolvedConflict(t *testing.T) {
	for _, status := range []string{"paused", "future_status", ""} {
		t.Run(status, func(t *testing.T) {
			owner := portalsession.Owner{CustomerID: "cus_1", Owned: []eligibility.Owned{
				{ID: "sub_old", Conflict: eligibility.ConflictResolved, StoredStatus: "active"},
			}}
			stripe := fakeStripe{subs: map[string]portalsession.Subscription{"sub_old": live(status)}}

			customer, err := prepare(t, owner, stripe, "pro")

			if !errors.Is(err, eligibility.ErrLiveStateUnknown) || customer != "" {
				t.Fatalf("Prepare = %q, %v; want ErrLiveStateUnknown and no Customer", customer, err)
			}
		})
	}
}

func TestSubscriptionCheckoutRetriesAnEmptyAcceptedLiveStatus(t *testing.T) {
	owner := portalsession.Owner{AcceptedID: "sub_live", AcceptedCustomerID: "cus_acc", CustomerID: "cus_1"}
	stripe := fakeStripe{subs: map[string]portalsession.Subscription{"sub_live": live("")}}

	customer, err := prepare(t, owner, stripe, "max")

	if !errors.Is(err, eligibility.ErrLiveStateUnknown) || customer != "" {
		t.Fatalf("Prepare = %q, %v; want retryable unknown state and no Customer", customer, err)
	}
}

func TestSubscriptionCheckoutAfterAnEndedSubscriptionUsesTheNormalCustomer(t *testing.T) {
	owner := portalsession.Owner{AcceptedID: "sub_gone", AcceptedCustomerID: "cus_acc", CustomerID: "cus_1"}
	customer, err := prepare(t, owner, fakeStripe{subs: map[string]portalsession.Subscription{"sub_gone": live("canceled")}}, "pro")

	if err != nil || customer != "cus_1" {
		t.Fatalf("Prepare = %q, %v; want cus_1", customer, err)
	}
}

func TestSubscriptionCheckoutDecidesOnTheAcceptedSubscriptionsLiveStatusNotTheStoredOne(t *testing.T) {
	accepted := func(stored string) portalsession.Owner {
		return portalsession.Owner{AcceptedID: "sub_acc", AcceptedCustomerID: "cus_acc", CustomerID: "cus_1", Owned: []eligibility.Owned{
			{ID: "sub_acc", StoredStatus: stored},
		}}
	}

	t.Run("stored active, canceled in Stripe allows", func(t *testing.T) {
		customer, err := prepare(t, accepted("active"), fakeStripe{subs: map[string]portalsession.Subscription{"sub_acc": live("canceled")}}, "pro")
		if err != nil || customer != "cus_1" {
			t.Fatalf("Prepare = %q, %v; want cus_1", customer, err)
		}
	})
	t.Run("stored canceled, active in Stripe refuses", func(t *testing.T) {
		_, err := prepare(t, accepted("canceled"), fakeStripe{subs: map[string]portalsession.Subscription{"sub_acc": live("active")}}, "pro")
		if !errors.Is(err, ErrRefused) {
			t.Fatalf("err = %v, want ErrRefused", err)
		}
	})
}

func TestFirstCheckoutWithNoCustomerReturnsEmpty(t *testing.T) {
	customer, err := prepare(t, portalsession.Owner{}, fakeStripe{}, "pro")

	if err != nil || customer != "" {
		t.Fatalf("Prepare = %q, %v; want no Customer and no error", customer, err)
	}
}

func TestTopUpUsesTheAcceptedSubscriptionsCustomer(t *testing.T) {
	owner := portalsession.Owner{AcceptedID: "sub_live", AcceptedCustomerID: "cus_acc", CustomerID: "cus_1"}
	customer, err := prepare(t, owner, fakeStripe{subs: map[string]portalsession.Subscription{"sub_live": live("active")}}, "")

	if err != nil || customer != "cus_acc" {
		t.Fatalf("Prepare = %q, %v; want cus_acc", customer, err)
	}
}

func TestTopUpSkipsTheSubscriptionChecks(t *testing.T) {
	owner := portalsession.Owner{CustomerID: "cus_1", Owned: []eligibility.Owned{
		{ID: "sub_x", Conflict: eligibility.ConflictOpen, StoredStatus: "active"},
	}}
	customer, err := prepare(t, owner, fakeStripe{}, "")

	if err != nil || customer != "cus_1" {
		t.Fatalf("Prepare = %q, %v; want cus_1", customer, err)
	}
}

func TestPrepareOpensNoSessionWhenARequiredReadFails(t *testing.T) {
	t.Run("owner read", func(t *testing.T) {
		storeErr := errors.New("db down")
		customer, err := New(fakeStore{err: storeErr}, fakeStripe{}).Prepare(context.Background(), "u-1", "")
		if !errors.Is(err, storeErr) || customer != "" {
			t.Fatalf("Prepare = %q, %v; want the store error", customer, err)
		}
	})
	t.Run("accepted subscription read", func(t *testing.T) {
		owner := portalsession.Owner{AcceptedID: "sub_live", AcceptedCustomerID: "cus_acc", CustomerID: "cus_1"}
		customer, err := prepare(t, owner, fakeStripe{}, "")
		if err == nil || customer != "" {
			t.Fatalf("Prepare = %q, %v; want an error and no Customer", customer, err)
		}
	})
}
