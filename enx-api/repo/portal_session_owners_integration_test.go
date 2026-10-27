//go:build integration

package repo

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/attribution"
	"enx-api/billing/conflict"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
	"enx-api/utils/sqlitex"
)

func TestPortalSessionOwnersReturnsConflictsOfAnEndedAcceptedSubscriptionForTheCheckoutGate(t *testing.T) {
	resolvedBillable := openConflict("sub_c", discoveredT0)
	resolvedBillable.ConflictStatus, resolvedBillable.ResolverID, resolvedBillable.ResolvedAt, resolvedBillable.Notes =
		conflict.Resolved, "admin_1", discoveredT0.Add(time.Hour), "Refunded sub_c in Stripe."
	for _, tc := range []struct {
		name string
		row  subscriptionRow
		want eligibility.Owned
		live *eligibility.Live // the live state cutover would read; nil when the stored state decides
	}{
		{name: "an open conflict", row: openConflict("sub_b", discoveredT0),
			want: eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "active"}},
		{name: "a resolved conflict whose stored status is billable", row: resolvedBillable,
			want: eligibility.Owned{ID: "sub_c", Conflict: eligibility.ConflictResolved, StoredStatus: "active"},
			live: &eligibility.Live{Status: "active"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 2)
			seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "canceled", Classification: "accepted"})
			seedSubscription(t, tc.row)
			acceptSubscription(t, "user_1", "sub_a")

			got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

			if err != nil {
				t.Fatalf("Owner: %v", err)
			}
			want := []eligibility.Owned{
				{ID: "sub_a", Conflict: eligibility.NoConflict, StoredStatus: "canceled"},
				tc.want,
			}
			if !reflect.DeepEqual(got.Owned, want) {
				t.Fatalf("Owned = %+v, want %+v", got.Owned, want)
			}
			owned := append([]eligibility.Owned(nil), got.Owned...)
			owned[1].Live = tc.live
			blocked, err := eligibility.BlockingConflict(owned)
			if err != nil || blocked != tc.want.ID {
				t.Errorf("BlockingConflict = %q, %v, want %q", blocked, err, tc.want.ID)
			}
		})
	}
}

func TestPortalSessionOwnersReturnsAnInProgressDeletionGateWithTheUsersSubscriptions(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 1)
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
	acceptSubscription(t, "user_1", "sub_a")
	seedDeletionGate(t, "user_1", "in_progress")

	got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

	if err != nil {
		t.Fatalf("Owner: %v", err)
	}
	if got.Deletion != acceptance.DeletionInProgress || got.AcceptedID != "sub_a" || len(got.Owned) != 1 {
		t.Errorf("Owner = %+v, want deletion in progress with sub_a accepted and owned", got)
	}
}

func TestPortalSessionOwnersReturnsADatabaseErrorNotAnEmptyOwner(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 0)
	if err := sqlitex.DB.Exec("DROP TABLE subscriptions").Error; err != nil {
		t.Fatal(err)
	}

	got, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

	if err == nil {
		t.Fatalf("Owner = %+v, want an error", got)
	}
	if !reflect.DeepEqual(got, portalsession.Owner{}) {
		t.Errorf("Owner = %+v alongside the error, want the zero value", got)
	}
}

type portalCustomerStripe struct {
	liveStatus string
	sessions   []portalsession.Session
}

func (f *portalCustomerStripe) Subscription(context.Context, string) (portalsession.Subscription, error) {
	return portalsession.Subscription{Live: eligibility.Live{Status: f.liveStatus}}, nil
}

func (f *portalCustomerStripe) TierPrices(context.Context) (map[string]string, error) {
	return map[string]string{"pro": "price_pro"}, nil
}

func (f *portalCustomerStripe) PlanChangeConfiguration(context.Context, map[string]string) (string, error) {
	return "bpc_change", nil
}

func (f *portalCustomerStripe) RestrictedConfiguration(context.Context) (string, error) {
	return "bpc_restricted", nil
}

func (f *portalCustomerStripe) CreateSession(_ context.Context, session portalsession.Session) (string, error) {
	f.sessions = append(f.sessions, session)
	return "https://billing.stripe.com/p/session/test", nil
}

func TestPortalSessionOwnersSuppliesTheInputsOfTheCustomerCheckoutReuses(t *testing.T) {
	for _, tc := range []struct {
		name       string
		accepted   bool
		customers  []string // in the order they are recorded
		spread     bool     // each Customer recorded an hour after the previous; else all in one millisecond
		liveStatus string
		want       string
	}{
		{name: "a live accepted subscription keeps its Customer over a newer top-up Customer", accepted: true,
			customers: []string{"cus_a", "cus_b"}, spread: true, liveStatus: "past_due", want: "cus_a"},
		{name: "an ended accepted subscription moves to the newer Customer", accepted: true,
			customers: []string{"cus_a", "cus_b"}, spread: true, liveStatus: "canceled", want: "cus_b"},
		{name: "no accepted subscription selects the latest Customer",
			customers: []string{"cus_a", "cus_b"}, spread: true, want: "cus_b"},
		{name: "equal created_at picks the later rowid", customers: []string{"cus_z", "cus_y"}, want: "cus_y"},
		{name: "no Customers selects none", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 1)
			if tc.accepted {
				seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
				acceptSubscription(t, "user_1", "sub_a")
			}
			for i, id := range tc.customers {
				at := discoveredT0
				if tc.spread {
					at = at.Add(time.Duration(i) * time.Hour)
				}
				seedCustomer(t, id, "user_1", at)
			}

			owner, err := PortalSessionOwners{}.Owner(context.Background(), "user_1")

			if err != nil {
				t.Fatalf("Owner: %v", err)
			}
			stripe := &portalCustomerStripe{liveStatus: tc.liveStatus}
			_, err = portalsession.New(PortalSessionOwners{}, stripe, "https://enx.example/billing").Home(context.Background(), "user_1")
			if tc.want == "" {
				if !errors.Is(err, portalsession.ErrNoCustomer) || len(stripe.sessions) != 0 {
					t.Fatalf("Home error = %v, sessions = %+v, want no Customer and no session", err, stripe.sessions)
				}
			} else {
				if err != nil {
					t.Fatalf("Home: %v", err)
				}
				if len(stripe.sessions) != 1 || stripe.sessions[0].CustomerID != tc.want {
					t.Errorf("Portal sessions = %+v, want one on Customer %q", stripe.sessions, tc.want)
				}
			}
			selected := attribution.SelectCustomer(tc.customers, attribution.Accepted{
				SubscriptionID: owner.AcceptedID, CustomerID: owner.AcceptedCustomerID, Status: tc.liveStatus})
			if selected != tc.want {
				t.Errorf("SelectCustomer = %q, want %q", selected, tc.want)
			}
		})
	}
}
