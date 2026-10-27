//go:build integration

package repo

import (
	"context"
	"testing"
	"time"

	"enx-api/adminuser"
	"enx-api/utils/sqlitex"
)

func seedAdminOwner(t *testing.T, userID string, createdAt time.Time) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email, name, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
		userID, "clerk_"+userID, userID+"@example.com", userID, createdAt.UTC().Format("2006-01-02 15:04:05")).Error; err != nil {
		t.Fatalf("seed user %s: %v", userID, err)
	}
}

func seedMultiOwnerAccount(t *testing.T, acceptedStatus string) {
	t.Helper()
	seedAdminOwner(t, "user_1", discoveredT0)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: acceptedStatus, Classification: "accepted"})
	acceptSubscription(t, "user_1", "sub_a")
	seedCustomer(t, "cus_a", "user_1", discoveredT0)
	seedCustomer(t, "cus_topup", "user_1", discoveredT0.Add(time.Hour))
}

func TestAcceptedAdminUsersShowOneRowPerUserWithTheAcceptedSubscriptionAndSelectedCustomer(t *testing.T) {
	for _, tc := range []struct {
		name, status, customer string
	}{
		{"live accepted subscription keeps its Customer", "active", "cus_a"},
		{"ended accepted subscription falls back to the latest Customer", "canceled", "cus_topup"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedMultiOwnerAccount(t, tc.status)
			store := AcceptedAdminUsers{AdminUsers{Now: time.Now}}

			accounts, total, err := store.ListAccounts(context.Background(), adminuser.ListQuery{Sort: adminuser.SortCreated, Limit: 50})
			if err != nil {
				t.Fatal(err)
			}
			if total != 1 || len(accounts) != 1 {
				t.Fatalf("list = %d accounts, total %d, want one row", len(accounts), total)
			}
			detail, ok, err := store.Account(context.Background(), "user_1")
			if err != nil || !ok {
				t.Fatalf("Account = %v, %v", ok, err)
			}
			for name, a := range map[string]adminuser.Account{"list": accounts[0], "detail": detail} {
				if a.Plan != "pro" || a.SubscriptionStatus != tc.status || a.StripeCustomerID != tc.customer {
					t.Fatalf("%s = plan %q status %q customer %q, want pro/%s/%s",
						name, a.Plan, a.SubscriptionStatus, a.StripeCustomerID, tc.status, tc.customer)
				}
			}
		})
	}
}

func TestAcceptedAdminUsersWithoutSubscriptionOrCustomerShowBlanks(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedAdminOwner(t, "user_1", discoveredT0)
	seedSubscription(t, openConflict("sub_b", discoveredT0))

	a, ok, err := AcceptedAdminUsers{AdminUsers{Now: time.Now}}.Account(context.Background(), "user_1")
	if err != nil || !ok {
		t.Fatalf("Account = %v, %v", ok, err)
	}
	if a.Plan != "" || a.SubscriptionStatus != "" || a.StripeCustomerID != "" {
		t.Fatalf("account = %+v, want no plan, status or Customer: a conflict row is not the accepted subscription", a)
	}
}

func TestAcceptedAdminUsersPagesOneRowPerUser(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedMultiOwnerAccount(t, "active")
	seedAdminOwner(t, "user_2", discoveredT0.Add(time.Hour))
	seedAdminOwner(t, "user_3", discoveredT0.Add(2*time.Hour))
	store := AcceptedAdminUsers{AdminUsers{Now: time.Now}}

	var got []string
	for offset := 0; offset < 3; offset++ {
		accounts, total, err := store.ListAccounts(context.Background(), adminuser.ListQuery{Sort: adminuser.SortCreated, Limit: 1, Offset: offset})
		if err != nil {
			t.Fatal(err)
		}
		if total != 3 || len(accounts) != 1 {
			t.Fatalf("offset %d: %d accounts, total %d, want 1 of 3", offset, len(accounts), total)
		}
		got = append(got, accounts[0].UserID)
	}
	if got[0] != "user_3" || got[1] != "user_2" || got[2] != "user_1" {
		t.Fatalf("pages = %v, want newest first without repeats", got)
	}
}
