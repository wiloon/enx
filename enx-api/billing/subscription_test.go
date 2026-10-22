package billing

import (
	"testing"

	"enx-api/utils/sqlitex"
)

func TestHasLiveSubscription(t *testing.T) {
	subID := "sub_A"
	cases := []struct {
		name   string
		subID  *string
		status string
		want   bool
	}{
		{"active", &subID, "active", true},
		{"trialing", &subID, "trialing", true},
		{"past_due", &subID, "past_due", true},
		{"incomplete", &subID, "incomplete", true},
		{"unpaid", &subID, "unpaid", true},
		{"canceled", &subID, "canceled", false},
		{"incomplete_expired", &subID, "incomplete_expired", false},
		{"none", &subID, "none", false},
		{"empty status", &subID, "", false},
		{"no subscription id", nil, "active", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sub := sqlitex.Subscription{StripeSubscriptionId: tc.subID, Status: tc.status}
			if got := hasLiveSubscription(sub); got != tc.want {
				t.Fatalf("hasLiveSubscription(status=%q, subID=%v) = %v, want %v", tc.status, tc.subID, got, tc.want)
			}
		})
	}
}
