//go:build integration

package repo

import (
	"context"
	"testing"

	"enx-api/billing/subscription"
	"enx-api/utils/sqlitex"
)

func TestBillingSubscriptionsReadsOnlyTheAcceptedStoredSnapshot(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 0)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "past_due", Classification: "accepted"})
	acceptSubscription(t, "user_1", "sub_a")
	if err := sqlitex.DB.Exec("UPDATE subscriptions SET plan = 'max', current_period_end = 1795507901 WHERE stripe_subscription_id = 'sub_a'").Error; err != nil {
		t.Fatal(err)
	}

	got, err := (BillingSubscriptions{}).Subscription(context.Background(), "user_1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "past_due" || got.Plan != "max" || got.CurrentPeriodEnd != 1795507901 {
		t.Fatalf("Subscription = %+v, want accepted past_due/max/1795507901", got)
	}
}

func TestBillingSubscriptionsWithoutAnAcceptedSubscriptionReturnsDefaults(t *testing.T) {
	for _, scenario := range []string{"never subscribed", "top-up only", "conflict only", "missing user", "another user's pointer"} {
		t.Run(scenario, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			if scenario != "missing user" {
				seedBillingOwner(t, "user_1", 0)
			}
			switch scenario {
			case "top-up only":
				seedCustomer(t, "cus_topup", "user_1", discoveredT0)
			case "conflict only":
				seedSubscription(t, openConflict("sub_b", discoveredT0))
			case "another user's pointer":
				seedBillingOwner(t, "user_2", 0)
				seedSubscription(t, subscriptionRow{ID: "sub_other", UserID: "user_2", CustomerID: "cus_other", Status: "active", Classification: "accepted"})
				acceptSubscription(t, "user_1", "sub_other")
			}
			got, err := (BillingSubscriptions{}).Subscription(context.Background(), "user_1")
			if err != nil || got != (subscription.Snapshot{Status: "none"}) {
				t.Fatalf("Subscription = %+v, %v, want none/empty/zero without error", got, err)
			}
		})
	}
}

func TestBillingSubscriptionsDatabaseFailureIsNotAbsence(t *testing.T) {
	newSubscriptionConflictDB(t)
	if err := sqlitex.DB.Exec("DROP TABLE subscriptions").Error; err != nil {
		t.Fatal(err)
	}
	got, err := (BillingSubscriptions{}).Subscription(context.Background(), "user_1")
	if err == nil || got != (subscription.Snapshot{}) {
		t.Fatalf("Subscription with broken database = %+v, %v, want zero snapshot and error", got, err)
	}
}
