//go:build integration

package repo

import (
	"context"
	"testing"

	"enx-api/utils/sqlitex"
)

func TestAcceptedSubscriptionsOnlyTheAcceptedActiveSubscriptionConfersEntitlement(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 0)
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	acceptSubscription(t, "user_1", "sub_a")

	got, err := (AcceptedSubscriptions{}).IsActiveSubscriber(context.Background(), "user_1")
	if err != nil || !got {
		t.Fatalf("IsActiveSubscriber = %v, %v, want true with an accepted active subscription and an active conflict", got, err)
	}
}

func TestAcceptedSubscriptionsOnlyStoredActiveStatusConfersEntitlement(t *testing.T) {
	for _, status := range []string{"trialing", "past_due", "incomplete", "unpaid", "canceled", "incomplete_expired"} {
		t.Run(status, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 0)
			seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: status, Classification: "accepted"})
			acceptSubscription(t, "user_1", "sub_a")
			got, err := (AcceptedSubscriptions{}).IsActiveSubscriber(context.Background(), "user_1")
			if err != nil || got {
				t.Fatalf("IsActiveSubscriber = %v, %v, want false for stored status %s", got, err, status)
			}
		})
	}
}

func TestAcceptedSubscriptionsAbsenceIsNotADatabaseError(t *testing.T) {
	newSubscriptionConflictDB(t)
	got, err := (AcceptedSubscriptions{}).IsActiveSubscriber(context.Background(), "missing_user")
	if err != nil || got {
		t.Fatalf("IsActiveSubscriber(missing_user) = %v, %v, want false without error", got, err)
	}
	if err := sqlitex.DB.Exec("DROP TABLE subscriptions").Error; err != nil {
		t.Fatal(err)
	}
	got, err = (AcceptedSubscriptions{}).IsActiveSubscriber(context.Background(), "missing_user")
	if err == nil || got {
		t.Fatalf("IsActiveSubscriber with a broken database = %v, %v, want false and an error", got, err)
	}
}

func TestAcceptedSubscriptionsAnActiveConflictDoesNotConferEntitlement(t *testing.T) {
	for _, pointer := range []string{"", "sub_ended", "sub_other_user"} {
		t.Run("accepted_pointer_"+pointer, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 0)
			seedBillingOwner(t, "user_2", 0)
			seedSubscription(t, openConflict("sub_b", discoveredT0))
			seedSubscription(t, subscriptionRow{ID: "sub_ended", UserID: "user_1", CustomerID: "cus_a", Status: "canceled", Classification: "accepted"})
			seedSubscription(t, subscriptionRow{ID: "sub_other_user", UserID: "user_2", CustomerID: "cus_other", Status: "active", Classification: "accepted"})
			acceptSubscription(t, "user_1", pointer)

			got, err := (AcceptedSubscriptions{}).IsActiveSubscriber(context.Background(), "user_1")
			if err != nil || got {
				t.Fatalf("IsActiveSubscriber = %v, %v, want false: the active conflict grants nothing", got, err)
			}
		})
	}
}
