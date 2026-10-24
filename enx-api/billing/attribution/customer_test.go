package attribution

import "testing"

func TestRecordCustomer(t *testing.T) {
	cases := []struct {
		name         string
		currentOwner string
		customerID   string
		userID       string
		want         Ownership
	}{
		{
			name:       "a new Customer is recorded for the paying user",
			customerID: "cus_1", userID: "u1",
			want: RecordOwnership,
		},
		{
			name:         "a Customer the user already owns is not recorded twice",
			currentOwner: "u1", customerID: "cus_1", userID: "u1",
			want: AlreadyOwned,
		},
		{
			name:         "a Customer owned by another user is never reassigned",
			currentOwner: "u2", customerID: "cus_1", userID: "u1",
			want: OwnedByAnotherUser,
		},
		{
			name:       "a payment without a Customer records nothing",
			customerID: "", userID: "u1",
			want: NoCustomer,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := RecordCustomer(c.currentOwner, c.customerID, c.userID); got != c.want {
				t.Errorf("RecordCustomer(%q, %q, %q) = %v, want %v", c.currentOwner, c.customerID, c.userID, got, c.want)
			}
		})
	}
}

func TestSelectCustomer(t *testing.T) {
	cases := []struct {
		name     string
		owned    []string
		accepted Accepted
		want     string
	}{
		{
			name: "a user with no Customer gets none, so Checkout creates one",
			want: "",
		},
		{
			name:  "a top-up-only user reuses their Customer",
			owned: []string{"cus_topup"},
			want:  "cus_topup",
		},
		{
			name:  "without a live accepted subscription the most recently recorded Customer is reused",
			owned: []string{"cus_old", "cus_new"},
			want:  "cus_new",
		},
		{
			name:     "a live accepted subscription's Customer wins over a later top-up Customer",
			owned:    []string{"cus_sub", "cus_topup"},
			accepted: Accepted{SubscriptionID: "sub_a", CustomerID: "cus_sub", Status: "active"},
			want:     "cus_sub",
		},
		{
			name:     "a past-due accepted subscription is still live and keeps its Customer",
			owned:    []string{"cus_sub", "cus_topup"},
			accepted: Accepted{SubscriptionID: "sub_a", CustomerID: "cus_sub", Status: "past_due"},
			want:     "cus_sub",
		},
		{
			name:     "competing Customers from concurrent checkouts do not move the accepted subscription's Customer",
			owned:    []string{"cus_a", "cus_conflict"},
			accepted: Accepted{SubscriptionID: "sub_a", CustomerID: "cus_a", Status: "active"},
			want:     "cus_a",
		},
		{
			name:     "after the accepted subscription ended normal reuse resumes",
			owned:    []string{"cus_sub", "cus_topup"},
			accepted: Accepted{SubscriptionID: "sub_a", CustomerID: "cus_sub", Status: "canceled"},
			want:     "cus_topup",
		},
		{
			name:     "an expired first checkout no longer selects its Customer",
			owned:    []string{"cus_sub", "cus_topup"},
			accepted: Accepted{SubscriptionID: "sub_a", CustomerID: "cus_sub", Status: "incomplete_expired"},
			want:     "cus_topup",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := SelectCustomer(c.owned, c.accepted); got != c.want {
				t.Errorf("SelectCustomer(%v, %+v) = %q, want %q", c.owned, c.accepted, got, c.want)
			}
		})
	}
}
