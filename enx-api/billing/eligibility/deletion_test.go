package eligibility

import "testing"

const periodEnd = 2000

func live(status string) *Live {
	return &Live{Status: status, CurrentPeriodEnd: periodEnd}
}

func TestDeletion(t *testing.T) {
	cases := []struct {
		name  string
		owned []Owned
		want  DeletionVerdict
	}{
		{
			name: "a user who never subscribed may delete",
			want: DeletionAllowed,
		},
		{
			name:  "a canceled subscription does not block",
			owned: []Owned{{ID: "sub_a", Live: live("canceled")}},
			want:  DeletionAllowed,
		},
		{
			name:  "an expired first checkout does not block",
			owned: []Owned{{ID: "sub_a", Live: live("incomplete_expired")}},
			want:  DeletionAllowed,
		},
		{
			name:  "a stored terminal status is authoritative without a live lookup",
			owned: []Owned{{ID: "sub_a", StoredStatus: "canceled"}},
			want:  DeletionAllowed,
		},
		{
			name:  "a renewing active subscription blocks",
			owned: []Owned{{ID: "sub_a", StoredStatus: "active", Live: live("active")}},
			want:  DeletionBlockedRenewing,
		},
		{
			name:  "an unpaid subscription is checked in Stripe and blocks while it renews",
			owned: []Owned{{ID: "sub_a", StoredStatus: "unpaid", Live: live("unpaid")}},
			want:  DeletionBlockedRenewing,
		},
		{
			name:  "an incomplete subscription is checked in Stripe and blocks while it renews",
			owned: []Owned{{ID: "sub_a", StoredStatus: "incomplete", Live: live("incomplete")}},
			want:  DeletionBlockedRenewing,
		},
		{
			name:  "a stale local active snapshot gives way to Stripe's canceled",
			owned: []Owned{{ID: "sub_a", StoredStatus: "active", Live: live("canceled")}},
			want:  DeletionAllowed,
		},
		{
			name:  "a stale local canceled snapshot is not trusted over a live renewing one",
			owned: []Owned{{ID: "sub_a", StoredStatus: "canceled", Live: live("active")}},
			want:  DeletionBlockedRenewing,
		},
		{
			name:  "a period-end cancellation does not block",
			owned: []Owned{{ID: "sub_a", Live: &Live{Status: "active", CancelAtPeriodEnd: true, CurrentPeriodEnd: periodEnd}}},
			want:  DeletionAllowed,
		},
		{
			name:  "a flexible-billing cancel_at at the period end does not block",
			owned: []Owned{{ID: "sub_a", Live: &Live{Status: "active", CancelAt: periodEnd, CurrentPeriodEnd: periodEnd}}},
			want:  DeletionAllowed,
		},
		{
			name:  "a cancel_at before the period end does not block",
			owned: []Owned{{ID: "sub_a", Live: &Live{Status: "active", CancelAt: periodEnd - 1, CurrentPeriodEnd: periodEnd}}},
			want:  DeletionAllowed,
		},
		{
			name:  "a cancel_at after the period end still renews once and blocks",
			owned: []Owned{{ID: "sub_a", Live: &Live{Status: "active", CancelAt: periodEnd + 1, CurrentPeriodEnd: periodEnd}}},
			want:  DeletionBlockedRenewing,
		},
		{
			name:  "a scheduled downgrade does not stop a period-end cancellation from counting",
			owned: []Owned{{ID: "sub_a", Live: &Live{Status: "active", HasSchedule: true, CancelAt: periodEnd, CurrentPeriodEnd: periodEnd}}},
			want:  DeletionAllowed,
		},
		{
			name:  "a subscription with an unknown local status and no live answer blocks",
			owned: []Owned{{ID: "sub_a", StoredStatus: "paused"}},
			want:  DeletionBlockedLookup,
		},
		{
			name:  "a failed lookup (no live answer) blocks rather than proving cancellation",
			owned: []Owned{{ID: "sub_a", StoredStatus: "active"}},
			want:  DeletionBlockedLookup,
		},
		{
			name:  "an open conflict blocks even after Stripe canceled it",
			owned: []Owned{{ID: "sub_b", Conflict: ConflictOpen, Live: live("canceled")}},
			want:  DeletionBlockedOpenConflict,
		},
		{
			name: "an open conflict is reported before a renewing accepted subscription",
			owned: []Owned{
				{ID: "sub_a", Live: live("active")},
				{ID: "sub_b", Conflict: ConflictOpen, Live: live("active")},
			},
			want: DeletionBlockedOpenConflict,
		},
		{
			name:  "a resolved conflict that still renews blocks",
			owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("active")}},
			want:  DeletionBlockedRenewing,
		},
		{
			name:  "a resolved conflict Stripe canceled does not block",
			owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("canceled")}},
			want:  DeletionAllowed,
		},
		{
			name: "a renewing subscription is reported before another one's failed lookup",
			owned: []Owned{
				{ID: "sub_a", StoredStatus: "active"},
				{ID: "sub_b", Live: live("active")},
			},
			want: DeletionBlockedRenewing,
		},
		{
			name: "every owned subscription is checked, not only the accepted one",
			owned: []Owned{
				{ID: "sub_a", Live: live("canceled")},
				{ID: "sub_b", Live: live("past_due")},
			},
			want: DeletionBlockedRenewing,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Deletion(tc.owned); got != tc.want {
				t.Fatalf("Deletion = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNeedsLiveLookup(t *testing.T) {
	cases := []struct {
		stored string
		want   bool
	}{
		{"canceled", false},
		{"incomplete_expired", false},
		{"active", true},
		{"unpaid", true},
		{"incomplete", true},
		{"paused", true},
		{"", true},
	}
	for _, tc := range cases {
		if got := NeedsLiveLookup(Owned{StoredStatus: tc.stored}); got != tc.want {
			t.Errorf("NeedsLiveLookup(stored %q) = %v, want %v", tc.stored, got, tc.want)
		}
	}
}
