package eligibility

import (
	"errors"
	"testing"

	"enx-api/billing/acceptance"
)

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
			name:    "an ended accepted subscription allows a new subscription to the same tier",
			account: Account{Accepted: accepted("pro", "canceled")},
			tier:    "pro",
			want:    Entry{Kind: EntryCheckout},
		},
		{
			name:    "an expired first checkout allows a new subscription to another tier",
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
			name:    "a blocking conflict blocks a new subscription after the accepted subscription ended",
			account: Account{BlockingConflictID: "sub_b", Accepted: accepted("pro", "canceled")},
			tier:    "pro",
			want:    Entry{Kind: EntryBlocked, Reason: ReasonSubscriptionConflict},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := TierEntry(tc.account, tc.tier)
			if err != nil || got != tc.want {
				t.Fatalf("TierEntry = %+v, %v; want %+v", got, err, tc.want)
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
			got, err := PortalRestricted(tc.account)
			if err != nil || got != tc.want {
				t.Fatalf("PortalRestricted = %v, %v; want %v", got, err, tc.want)
			}
		})
	}
}

func TestTierEntryRequiresTheAcceptedLiveStatus(t *testing.T) {
	a := Account{Accepted: &Accepted{Tier: "pro"}}
	_, err := TierEntry(a, "max")
	if !errors.Is(err, ErrLiveStateUnknown) {
		t.Fatalf("TierEntry error = %v; want ErrLiveStateUnknown", err)
	}
}

func TestPortalRestrictionRequiresTheAcceptedLiveStatus(t *testing.T) {
	a := Account{Accepted: &Accepted{Tier: "pro"}}
	_, err := PortalRestricted(a)
	if !errors.Is(err, ErrLiveStateUnknown) {
		t.Fatalf("PortalRestricted error = %v; want ErrLiveStateUnknown", err)
	}
}
