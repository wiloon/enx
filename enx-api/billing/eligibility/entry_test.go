package eligibility

import (
	"errors"
	"testing"

	"enx-api/billing/acceptance"
)

func accepted(tier, status string) *Accepted {
	return &Accepted{Tier: tier, Live: Live{Status: status, CurrentPeriodEnd: periodEnd}}
}

func TestTierEntry(t *testing.T) {
	cases := []struct {
		name    string
		account Account
		tier    string
		want    Entry
	}{
		{
			name: "a user with no subscription gets Checkout",
			tier: "pro",
			want: Entry{Kind: EntryCheckout},
		},
		{
			name:    "an ended accepted subscription allows repurchase of the same tier",
			account: Account{Accepted: accepted("pro", "canceled")},
			tier:    "pro",
			want:    Entry{Kind: EntryCheckout},
		},
		{
			name:    "an expired first checkout allows repurchase of another tier",
			account: Account{Accepted: accepted("pro", "incomplete_expired")},
			tier:    "max",
			want:    Entry{Kind: EntryCheckout},
		},
		{
			name:    "a healthy subscriber's other tier opens the Portal plan change",
			account: Account{Accepted: accepted("pro", "active")},
			tier:    "max",
			want:    Entry{Kind: EntryPlanChange},
		},
		{
			name:    "a healthy subscriber's current tier has no entry",
			account: Account{Accepted: accepted("pro", "active")},
			tier:    "pro",
			want:    Entry{Kind: EntryCurrentTier},
		},
		{
			name:    "a pending upgrade sends the user to the Portal home",
			account: Account{Accepted: &Accepted{Tier: "pro", Live: Live{Status: "active", PendingUpdate: true}}},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "a scheduled downgrade sends the user to the Portal home",
			account: Account{Accepted: &Accepted{Tier: "max", Live: Live{Status: "active", HasSchedule: true}}},
			tier:    "pro",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "a period-end cancellation sends the user to the Portal home",
			account: Account{Accepted: &Accepted{Tier: "pro", Live: Live{Status: "active", CancelAtPeriodEnd: true}}},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "a flexible-billing cancel_at at the period end sends the user to the Portal home",
			account: Account{Accepted: &Accepted{Tier: "pro", Live: Live{Status: "active", CancelAt: periodEnd, CurrentPeriodEnd: periodEnd}}},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "a past-due subscriber gets the Portal home, never a second Checkout",
			account: Account{Accepted: accepted("pro", "past_due")},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "an unpaid subscriber gets the Portal home",
			account: Account{Accepted: accepted("pro", "unpaid")},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "an incomplete subscriber gets the Portal home",
			account: Account{Accepted: accepted("pro", "incomplete")},
			tier:    "pro",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "trialing is not healthy",
			account: Account{Accepted: accepted("pro", "trialing")},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "an unrecognized accepted status gets the Portal home rather than a second Checkout",
			account: Account{Accepted: accepted("pro", "paused")},
			tier:    "max",
			want:    Entry{Kind: EntryPortalHome},
		},
		{
			name:    "the deletion gate blocks Checkout",
			account: Account{Deletion: acceptance.DeletionInProgress},
			tier:    "pro",
			want:    Entry{Kind: EntryBlocked, Reason: ReasonDeletionInProgress},
		},
		{
			name:    "the deletion gate blocks a plan change",
			account: Account{Deletion: acceptance.DeletionInProgress, Accepted: accepted("pro", "active")},
			tier:    "max",
			want:    Entry{Kind: EntryBlocked, Reason: ReasonDeletionInProgress},
		},
		{
			name:    "a blocking conflict blocks a plan change",
			account: Account{BlockingConflictID: "sub_b", Accepted: accepted("pro", "active")},
			tier:    "max",
			want:    Entry{Kind: EntryBlocked, Reason: ReasonSubscriptionConflict},
		},
		{
			name:    "a blocking conflict blocks repurchase after the accepted subscription ended",
			account: Account{BlockingConflictID: "sub_b", Accepted: accepted("pro", "canceled")},
			tier:    "pro",
			want:    Entry{Kind: EntryBlocked, Reason: ReasonSubscriptionConflict},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := TierEntry(tc.account, tc.tier); got != tc.want {
				t.Fatalf("TierEntry = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestPortalRestricted(t *testing.T) {
	cases := []struct {
		name    string
		account Account
		want    bool
	}{
		{name: "a top-up-only customer gets the plan-change configuration", want: false},
		{name: "a healthy subscriber gets the plan-change configuration", account: Account{Accepted: accepted("pro", "active")}, want: false},
		{name: "an ended subscriber gets the plan-change configuration", account: Account{Accepted: accepted("pro", "canceled")}, want: false},
		{name: "a past-due subscriber gets the restricted configuration", account: Account{Accepted: accepted("pro", "past_due")}, want: true},
		{name: "an unpaid subscriber gets the restricted configuration", account: Account{Accepted: accepted("pro", "unpaid")}, want: true},
		{name: "an unrecognized status gets the restricted configuration", account: Account{Accepted: accepted("pro", "paused")}, want: true},
		{name: "the deletion gate restricts a healthy subscriber", account: Account{Deletion: acceptance.DeletionInProgress, Accepted: accepted("pro", "active")}, want: true},
		{name: "a blocking conflict restricts a healthy subscriber", account: Account{BlockingConflictID: "sub_b", Accepted: accepted("pro", "active")}, want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := PortalRestricted(tc.account); got != tc.want {
				t.Fatalf("PortalRestricted = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBlockingConflict(t *testing.T) {
	cases := []struct {
		name    string
		owned   []Owned
		want    string
		wantErr error
	}{
		{name: "no conflict", owned: []Owned{{ID: "sub_a", Live: live("active")}}, want: ""},
		{name: "an open conflict blocks even after Stripe ended it", owned: []Owned{{ID: "sub_b", Conflict: ConflictOpen, Live: live("canceled")}}, want: "sub_b"},
		{name: "an open conflict blocks without a live lookup", owned: []Owned{{ID: "sub_b", Conflict: ConflictOpen}}, want: "sub_b"},
		{name: "a resolved conflict still billable blocks", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("past_due")}}, want: "sub_b"},
		{name: "a resolved conflict with a period-end cancellation still blocks while billable", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: &Live{Status: "active", CancelAtPeriodEnd: true}}}, want: "sub_b"},
		{name: "a resolved conflict Stripe canceled does not block", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("canceled")}}, want: ""},
		{name: "a resolved conflict stored as canceled does not block", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, StoredStatus: "canceled"}}, want: ""},
		{name: "a resolved conflict whose live state is unknown fails closed", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, StoredStatus: "active"}}, wantErr: ErrLiveStateUnknown},
		{
			name: "a known blocking conflict wins over another's unknown state",
			owned: []Owned{
				{ID: "sub_b", Conflict: ConflictResolved, StoredStatus: "active"},
				{ID: "sub_c", Conflict: ConflictOpen},
			},
			want: "sub_c",
		},
		{
			name: "the smallest blocking ID wins whatever the store order",
			owned: []Owned{
				{ID: "sub_z", Conflict: ConflictOpen},
				{ID: "sub_m", Conflict: ConflictResolved, Live: live("active")},
				{ID: "sub_c", Conflict: ConflictResolved, Live: live("canceled")},
				{ID: "sub_d", Conflict: ConflictResolved, StoredStatus: "active"},
				{ID: "sub_n", Conflict: ConflictOpen, Live: live("canceled")},
			},
			want: "sub_m",
		},
		{
			name: "ended, unconflicted and unknown rows are no candidates",
			owned: []Owned{
				{ID: "sub_a", Conflict: NoConflict, Live: live("active")},
				{ID: "sub_b", Conflict: ConflictResolved, Live: live("canceled")},
				{ID: "sub_c", Conflict: ConflictResolved, StoredStatus: "active"},
			},
			wantErr: ErrLiveStateUnknown,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := BlockingConflict(tc.owned)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("BlockingConflict error = %v, want %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("BlockingConflict = %q, want %q", got, tc.want)
			}
		})
	}
}
