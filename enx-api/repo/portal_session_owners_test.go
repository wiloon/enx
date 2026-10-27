package repo

import (
	"context"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/conflict"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
	"enx-api/utils/sqlitex"
)

func acceptSubscription(t *testing.T, userID, subscriptionID string) {
	t.Helper()
	if err := sqlitex.DB.Exec("UPDATE users SET accepted_subscription_id = ? WHERE id = ?", subscriptionID, userID).Error; err != nil {
		t.Fatalf("accept %s for %s: %v", subscriptionID, userID, err)
	}
}

func seedCustomer(t *testing.T, customerID, userID string, at time.Time) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO stripe_customers (stripe_customer_id, user_id, created_at) VALUES (?, ?, ?)",
		customerID, userID, at.UnixMilli()).Error; err != nil {
		t.Fatalf("seed Customer %s: %v", customerID, err)
	}
}

func seedDeletionGate(t *testing.T, userID, state string) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at) VALUES (?, ?, ?, ?)",
		userID, state, discoveredT0.UnixMilli(), discoveredT0.UnixMilli()).Error; err != nil {
		t.Fatalf("seed deletion gate of %s: %v", userID, err)
	}
}

func TestPortalSessionOwnersReadsEveryOwnedSubscriptionTheAcceptedOneAndTheNormalCustomer(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 3)
	seedBillingOwner(t, "user_2", 1)
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
	open := openConflict("sub_b", discoveredT0)
	open.Status = "past_due"
	seedSubscription(t, open)
	resolved := openConflict("sub_c", discoveredT0)
	resolved.Status, resolved.ConflictStatus, resolved.ResolverID, resolved.ResolvedAt, resolved.Notes =
		"canceled", conflict.Resolved, "admin_1", discoveredT0.Add(time.Hour), "Refunded sub_c in Stripe."
	seedSubscription(t, resolved)
	seedSubscription(t, subscriptionRow{ID: "sub_d", UserID: "user_1", CustomerID: "cus_a", Status: "incomplete_expired", Classification: "stale"})
	seedSubscription(t, subscriptionRow{ID: "sub_e", UserID: "user_2", CustomerID: "cus_e", Status: "active", Classification: "accepted"})
	seedSubscription(t, subscriptionRow{ID: "sub_f", CustomerID: "cus_f", Status: "active"})
	acceptSubscription(t, "user_1", "sub_a")
	seedCustomer(t, "cus_a", "user_1", discoveredT0)
	seedCustomer(t, "cus_top", "user_1", discoveredT0.Add(time.Hour))
	seedCustomer(t, "cus_e", "user_2", discoveredT0.Add(2*time.Hour))

	got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

	if err != nil {
		t.Fatalf("Owner: %v", err)
	}
	want := portalsession.Owner{
		Deletion: acceptance.NoDeletion,
		Owned: []eligibility.Owned{
			{ID: "sub_a", Conflict: eligibility.NoConflict, StoredStatus: "active"},
			{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "past_due"},
			{ID: "sub_c", Conflict: eligibility.ConflictResolved, StoredStatus: "canceled"},
			{ID: "sub_d", Conflict: eligibility.NoConflict, StoredStatus: "incomplete_expired"},
		},
		AcceptedID:         "sub_a",
		AcceptedCustomerID: "cus_a",
		CustomerID:         "cus_top",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Owner(user_1) =\n%+v\nwant\n%+v", got, want)
	}
}

func TestPortalSessionOwnersReusesTheMostRecentlyRecordedCustomerWithNoAcceptedSubscription(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 0)
	// Recorded in the same millisecond: the later insert is the more recent.
	seedCustomer(t, "cus_z", "user_1", discoveredT0)
	seedCustomer(t, "cus_y", "user_1", discoveredT0)

	got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

	if err != nil {
		t.Fatalf("Owner: %v", err)
	}
	if got.AcceptedID != "" || got.AcceptedCustomerID != "" || got.CustomerID != "cus_y" || len(got.Owned) != 0 {
		t.Errorf("Owner(user_1) = %+v, want no accepted subscription and Customer cus_y", got)
	}
}

func TestPortalSessionOwnersCountsAConflictWithNoRecordedResolutionAsOpen(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 0)
	row := openConflict("sub_b", discoveredT0)
	row.ConflictStatus = ""
	seedSubscription(t, row)

	got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

	if err != nil {
		t.Fatalf("Owner: %v", err)
	}
	want := []eligibility.Owned{{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "active"}}
	if !reflect.DeepEqual(got.Owned, want) {
		t.Errorf("Owned = %+v, want %+v", got.Owned, want)
	}
}

func TestPortalSessionOwnersReadsTheDeletionGate(t *testing.T) {
	for _, tc := range []struct {
		name  string
		state string // "" for no gate
		user  bool   // whether the users row still exists
		want  acceptance.Deletion
	}{
		{name: "no gate means no deletion", user: true, want: acceptance.NoDeletion},
		{name: "a raised gate means deletion in progress", state: "in_progress", user: true, want: acceptance.DeletionInProgress},
		{name: "the retained gate of a deleted user means deletion completed", state: "deleted", want: acceptance.DeletionCompleted},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			if tc.user {
				seedBillingOwner(t, "user_1", 0)
			}
			if tc.state != "" {
				seedDeletionGate(t, "user_1", tc.state)
			}

			got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

			if err != nil {
				t.Fatalf("Owner: %v", err)
			}
			if got.Deletion != tc.want {
				t.Errorf("Deletion = %v, want %v", got.Deletion, tc.want)
			}
		})
	}
}

func TestPortalSessionOwnersRefusesAnAcceptedPointerToASubscriptionTheUserDoesNotOwn(t *testing.T) {
	for _, tc := range []struct {
		name string
		seed func(t *testing.T)
	}{
		{name: "another user's subscription", seed: func(t *testing.T) {
			seedSubscription(t, subscriptionRow{ID: "sub_e", UserID: "user_2", CustomerID: "cus_e", Status: "active", Classification: "accepted"})
		}},
		{name: "a subscription ENX has no row for", seed: func(t *testing.T) {}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 0)
			tc.seed(t)
			acceptSubscription(t, "user_1", "sub_e")

			got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

			if err == nil {
				t.Fatalf("Owner = %+v, want an error rather than a Portal on a Customer user_1 may not own", got)
			}
		})
	}
}
