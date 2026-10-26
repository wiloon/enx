package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/conflict"
	"enx-api/billing/deletion"
	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
)

// liveStripe is a deletion.Stripe over canned live states; a subscription it
// has no state for is a failed lookup. It records every call.
type liveStripe struct {
	live  map[string]eligibility.Live
	asked []string
}

func (f *liveStripe) Subscription(_ context.Context, id string) (snapshot.Live, error) {
	f.asked = append(f.asked, id)
	live, ok := f.live[id]
	if !ok {
		return snapshot.Live{}, errors.New("resource_missing")
	}
	return snapshot.Live{Live: live}, nil
}

const sandboxPeriodEnd = 1795485941

func checkDeletion(t *testing.T, stripe *liveStripe) eligibility.DeletionVerdict {
	t.Helper()
	got, err := deletion.New(SubscriptionOwners{}, stripe).Check(context.Background(), "user_1")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	return got
}

func seedOwned(t *testing.T, id, status string) {
	t.Helper()
	seedSubscription(t, subscriptionRow{ID: id, UserID: "user_1", CustomerID: "cus_" + id, Status: status, Classification: "accepted"})
}

func TestDeletionIsAllowedWhenThePortalCanceledAtThePeriodEndInFlexibleBillingMode(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "active")
	stripe := &liveStripe{live: map[string]eligibility.Live{
		"sub_a": {Status: "active", CancelAt: sandboxPeriodEnd, CurrentPeriodEnd: sandboxPeriodEnd},
	}}

	if got := checkDeletion(t, stripe); got != eligibility.DeletionAllowed {
		t.Errorf("verdict = %v, want DeletionAllowed", got)
	}
}

func TestDeletionIsAllowedWhenCancelAtPeriodEndIsSetAndBlockedByALaterCancelAt(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "active")

	atPeriodEnd := &liveStripe{live: map[string]eligibility.Live{
		"sub_a": {Status: "active", CancelAtPeriodEnd: true, CurrentPeriodEnd: sandboxPeriodEnd},
	}}
	if got := checkDeletion(t, atPeriodEnd); got != eligibility.DeletionAllowed {
		t.Errorf("cancel_at_period_end: verdict = %v, want DeletionAllowed", got)
	}
	later := &liveStripe{live: map[string]eligibility.Live{
		"sub_a": {Status: "active", CancelAt: sandboxPeriodEnd + 1, CurrentPeriodEnd: sandboxPeriodEnd},
	}}
	if got := checkDeletion(t, later); got != eligibility.DeletionBlockedRenewing {
		t.Errorf("cancel_at after the period end: verdict = %v, want DeletionBlockedRenewing", got)
	}
}

func TestAStoredNonTerminalStatusIsLookedUpLive(t *testing.T) {
	for _, stored := range []string{"unpaid", "incomplete", "past_due", "some_future_status"} {
		t.Run(stored, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 1)
			seedOwned(t, "sub_a", stored)
			stripe := &liveStripe{live: map[string]eligibility.Live{
				"sub_a": {Status: "active", CurrentPeriodEnd: sandboxPeriodEnd},
			}}

			if got := checkDeletion(t, stripe); got != eligibility.DeletionBlockedRenewing {
				t.Errorf("verdict = %v, want DeletionBlockedRenewing", got)
			}
			if len(stripe.asked) != 1 {
				t.Errorf("Stripe asked %v, want one lookup of sub_a", stripe.asked)
			}
		})
	}
}

func TestLiveStateOverridesAStaleStoredActiveStatus(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "active")
	stripe := &liveStripe{live: map[string]eligibility.Live{"sub_a": {Status: "canceled"}}}

	if got := checkDeletion(t, stripe); got != eligibility.DeletionAllowed {
		t.Errorf("verdict = %v, want DeletionAllowed", got)
	}
}

func TestAStoredTerminalSubscriptionIsNeverLookedUp(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "canceled")
	seedOwned(t, "sub_b", "incomplete_expired")
	stripe := &liveStripe{}

	if got := checkDeletion(t, stripe); got != eligibility.DeletionAllowed {
		t.Errorf("verdict = %v, want DeletionAllowed", got)
	}
	if len(stripe.asked) != 0 {
		t.Errorf("Stripe asked %v, want no lookups", stripe.asked)
	}
}

func TestAFailedLookupBlocksDeletionAsUnknown(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "active")

	if got := checkDeletion(t, &liveStripe{}); got != eligibility.DeletionBlockedLookup {
		t.Errorf("verdict = %v, want DeletionBlockedLookup", got)
	}
}

func TestAnOpenConflictBlocksDeletionEvenWhenStripeSaysItEnded(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "canceled")
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	stripe := &liveStripe{live: map[string]eligibility.Live{"sub_b": {Status: "canceled"}}}

	if got := checkDeletion(t, stripe); got != eligibility.DeletionBlockedOpenConflict {
		t.Errorf("verdict = %v, want DeletionBlockedOpenConflict", got)
	}
}

func TestAResolvedConflictThatStillRenewsBlocksDeletion(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	resolved := openConflict("sub_c", discoveredT0)
	resolved.ConflictStatus, resolved.ResolverID, resolved.ResolvedAt, resolved.Notes =
		conflict.Resolved, "admin_1", discoveredT0.Add(time.Hour), "Kept sub_a."
	seedSubscription(t, resolved)
	stripe := &liveStripe{live: map[string]eligibility.Live{"sub_c": {Status: "active", CurrentPeriodEnd: sandboxPeriodEnd}}}

	if got := checkDeletion(t, stripe); got != eligibility.DeletionBlockedRenewing {
		t.Errorf("verdict = %v, want DeletionBlockedRenewing", got)
	}
}

func TestDeletionIsBlockedWhenAnyOneOfSeveralOwnedSubscriptionsRenews(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedOwned(t, "sub_a", "active")
	resolved := openConflict("sub_c", discoveredT0)
	resolved.ConflictStatus, resolved.ResolverID, resolved.ResolvedAt, resolved.Notes =
		conflict.Resolved, "admin_1", discoveredT0.Add(time.Hour), "Kept sub_a."
	seedSubscription(t, resolved)
	stripe := &liveStripe{live: map[string]eligibility.Live{
		"sub_a": {Status: "active", CancelAt: sandboxPeriodEnd, CurrentPeriodEnd: sandboxPeriodEnd},
		"sub_c": {Status: "active", CurrentPeriodEnd: sandboxPeriodEnd},
	}}

	if got := checkDeletion(t, stripe); got != eligibility.DeletionBlockedRenewing {
		t.Errorf("verdict = %v, want DeletionBlockedRenewing", got)
	}
}
