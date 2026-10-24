package creditperiod

import (
	"errors"
	"testing"

	"enx-api/billing/invoice"
)

var (
	may     = invoice.Period{Start: 1000, End: 2000}
	june    = invoice.Period{Start: 2000, End: 3000}
	april   = invoice.Period{Start: 0, End: 1000}
	bLonger = invoice.Period{Start: 1500, End: 4500}
	aMay    = Source{SubscriptionID: "sub_a", Period: may}
	aJune   = Source{SubscriptionID: "sub_a", Period: june}
	aApril  = Source{SubscriptionID: "sub_a", Period: april}
	bFirst  = Source{SubscriptionID: "sub_b", Period: bLonger}
	aYear   = Source{SubscriptionID: "sub_a", Period: invoice.Period{Start: 0, End: 10000}}
)

func TestNormalGrant(t *testing.T) {
	cases := []struct {
		name     string
		pool     Pool
		grant    Source
		accepted bool
		want     Effect
	}{
		{
			name:     "the first grant of the accepted subscription initializes the pool",
			grant:    aMay,
			accepted: true,
			want:     Effect{Outcome: Apply, Purchased: 100, Credits: 100},
		},
		{
			name:     "a new period of the accepted subscription resets the pool",
			pool:     Pool{Source: aMay},
			grant:    aJune,
			accepted: true,
			want:     Effect{Outcome: Apply, Purchased: 100, Credits: 100},
		},
		{
			name:     "the same period under another Event ID is recorded with no pool effect",
			pool:     Pool{Source: aMay},
			grant:    aMay,
			accepted: true,
			want:     Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name:     "a late older period is recorded with no pool effect",
			pool:     Pool{Source: aMay},
			grant:    aApril,
			accepted: true,
			want:     Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name:     "a replacement's first period initializes the pool even though it ends later and lasts longer",
			pool:     Pool{Source: aMay},
			grant:    bFirst,
			accepted: true,
			want:     Effect{Outcome: Apply, Purchased: 100, Credits: 100},
		},
		{
			name:     "a replacement's first period initializes the pool even though it ends before the annual period it replaces",
			pool:     Pool{Source: aYear},
			grant:    bFirst,
			accepted: true,
			want:     Effect{Outcome: Apply, Purchased: 100, Credits: 100},
		},
		{
			name:  "a late paid invoice of the historical subscription cannot overwrite the replacement's pool",
			pool:  Pool{Source: bFirst},
			grant: aJune,
			want:  Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name:     "a migrated pool without a recorded start still compares by period end",
			pool:     Pool{Source: Source{SubscriptionID: "sub_a", Period: invoice.Period{End: 2000}}, WithoutPeriod: true},
			grant:    aJune,
			accepted: true,
			want:     Effect{Outcome: Apply, Purchased: 100, Credits: 100},
		},
		{
			name:     "a migrated pool without a recorded start keeps its own period",
			pool:     Pool{Source: Source{SubscriptionID: "sub_a", Period: invoice.Period{End: 2000}}, WithoutPeriod: true},
			grant:    aMay,
			accepted: true,
			want:     Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name:     "nothing is decided before the legacy provenance backfill finishes",
			pool:     Pool{BackfillPending: true},
			grant:    aJune,
			accepted: true,
			want:     Effect{Outcome: WaitDependency, Reason: ReasonBackfillPending},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NormalGrant(tc.pool, tc.grant, tc.accepted, 100); got != tc.want {
				t.Errorf("NormalGrant(%+v, %+v, %v, 100) = %+v, want %+v", tc.pool, tc.grant, tc.accepted, got, tc.want)
			}
		})
	}
}

func TestUpgradeTopUp(t *testing.T) {
	// The upgrade on day 1500 leaves half of May: floor((300 - 100) * 1/2).
	half := invoice.Period{Start: 1500, End: 2000}
	mayGrant := &Grant{Source: aMay, Applied: 100}
	cases := []struct {
		name string
		in   Upgrade
		want Effect
	}{
		{
			name: "an upgrade in the pool's period adds its difference",
			in:   Upgrade{Pool: Pool{Source: aMay}, Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300, PeriodGrant: mayGrant},
			want: Effect{Outcome: Apply, Purchased: 100, Credits: 100},
		},
		{
			name: "a second upgrade in the same period adds its own difference over the same denominator",
			in:   Upgrade{Pool: Pool{Source: aMay}, Accepted: true, SubscriptionID: "sub_a", Line: invoice.Period{Start: 1750, End: 2000}, FromCredits: 300, ToCredits: 900, PeriodGrant: mayGrant},
			want: Effect{Outcome: Apply, Purchased: 150, Credits: 150},
		},
		{
			name: "an upgrade processed after the renewal is recorded with no pool effect",
			in:   Upgrade{Pool: Pool{Source: aJune}, Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300, PeriodGrant: mayGrant},
			want: Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name: "an upgrade before its period's normal grant waits",
			in:   Upgrade{Pool: Pool{Source: aApril}, Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300},
			want: Effect{Outcome: WaitDependency, Reason: ReasonNormalGrantMissing},
		},
		{
			name: "an upgrade of the historical subscription cannot add to the replacement's pool",
			in:   Upgrade{Pool: Pool{Source: bFirst}, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300, PeriodGrant: mayGrant},
			want: Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name: "an upgrade of a subscription no longer accepted adds nothing, even while its period still supplies the pool",
			in:   Upgrade{Pool: Pool{Source: aMay}, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300, PeriodGrant: mayGrant},
			want: Effect{Outcome: RecordOnly, Purchased: 100},
		},
		{
			name: "a target tier that grants no more credits needs attention",
			in:   Upgrade{Pool: Pool{Source: aMay}, Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 300, ToCredits: 100, PeriodGrant: mayGrant},
			want: Effect{Outcome: NeedsAttention, Reason: ReasonUpgradeNotHigher},
		},
		{
			name: "an upgrade over a migrated grant Stripe could not pin down needs attention",
			in: Upgrade{
				Pool:     Pool{Source: Source{SubscriptionID: "sub_a", Period: invoice.Period{End: 2000}}, WithoutPeriod: true},
				Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300,
				PeriodGrant: &Grant{WithoutPeriod: true, Applied: 100},
			},
			want: Effect{Outcome: NeedsAttention, Reason: ReasonLegacyGrantWithoutPeriod},
		},
		{
			name: "an upgrade over a migrated pool Stripe could not pin down needs attention without waiting for a grant the lookup cannot find",
			in: Upgrade{
				Pool:     Pool{Source: Source{SubscriptionID: "sub_a", Period: invoice.Period{End: 2000}}, WithoutPeriod: true},
				Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300,
			},
			want: Effect{Outcome: NeedsAttention, Reason: ReasonLegacyGrantWithoutPeriod},
		},
		{
			name: "nothing is decided before the legacy provenance backfill finishes",
			in:   Upgrade{Pool: Pool{BackfillPending: true}, Accepted: true, SubscriptionID: "sub_a", Line: half, FromCredits: 100, ToCredits: 300},
			want: Effect{Outcome: WaitDependency, Reason: ReasonBackfillPending},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := UpgradeTopUp(tc.in)
			if err != nil {
				t.Fatalf("UpgradeTopUp(%+v): %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("UpgradeTopUp(%+v) = %+v, want %+v", tc.in, got, tc.want)
			}
		})
	}
}

func TestUpgradeTopUpRefusesAGrantOfAnotherPeriod(t *testing.T) {
	in := Upgrade{
		Pool: Pool{Source: aMay}, Accepted: true, SubscriptionID: "sub_a",
		Line: invoice.Period{Start: 2500, End: 3000}, FromCredits: 100, ToCredits: 300,
		PeriodGrant: &Grant{Source: aMay, Applied: 100},
	}
	if _, err := UpgradeTopUp(in); !errors.Is(err, invoice.ErrGrantPeriodMismatch) {
		t.Errorf("UpgradeTopUp with May's grant for a June line: err = %v, want ErrGrantPeriodMismatch", err)
	}
	in.PeriodGrant = &Grant{Source: Source{SubscriptionID: "sub_b", Period: june}, Applied: 100}
	if _, err := UpgradeTopUp(in); !errors.Is(err, ErrGrantOfAnotherSubscription) {
		t.Errorf("UpgradeTopUp with another subscription's grant: err = %v, want ErrGrantOfAnotherSubscription", err)
	}
}

func TestClawback(t *testing.T) {
	cases := []struct {
		name   string
		pool   Pool
		grant  Grant
		refund Refund
		want   Effect
	}{
		{
			name:   "a full refund of the grant that supplies the pool takes it back",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: Apply, Credits: 100},
		},
		{
			name:   "a partial refund takes its share",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 250, Captured: 500, Balance: 100},
			want:   Effect{Outcome: Apply, Credits: 50},
		},
		{
			name:   "a cumulative refund takes only what earlier clawbacks of the grant left",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 400, Captured: 500, AlreadyTaken: 50, Balance: 60},
			want:   Effect{Outcome: Apply, Credits: 30},
		},
		{
			name:   "an earlier smaller refund delivered late hands nothing back",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 250, Captured: 500, AlreadyTaken: 80, Balance: 20},
			want:   Effect{Outcome: Apply},
		},
		{
			name:   "the subscription pool never goes below zero",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 30},
			want:   Effect{Outcome: Apply, Credits: 30},
		},
		{
			name:   "an upgrade top-up in the pool's period is clawed back on its own payment",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay, Applied: 200},
			refund: Refund{Refunded: 100, Captured: 200, Balance: 300},
			want:   Effect{Outcome: Apply, Credits: 100},
		},
		{
			name:   "a refund of the historical subscription cannot debit the replacement",
			pool:   Pool{Source: bFirst},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 300},
			want:   Effect{Outcome: RecordOnly},
		},
		{
			name:   "a refund of an earlier period of the same subscription takes nothing",
			pool:   Pool{Source: aJune},
			grant:  Grant{Source: aMay, Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: RecordOnly},
		},
		{
			name:   "a refund of a grant that never reached the pool takes nothing",
			pool:   Pool{Source: aMay},
			grant:  Grant{Source: aMay},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: RecordOnly},
		},
		{
			name:   "an old ledger grant the backfill did not cover takes nothing",
			pool:   Pool{Source: aMay},
			grant:  Grant{Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: RecordOnly},
		},
		{
			name:   "a refund of the migrated grant Stripe could not pin down needs attention",
			pool:   Pool{Source: Source{SubscriptionID: "sub_a", Period: invoice.Period{End: 2000}}, WithoutPeriod: true},
			grant:  Grant{WithoutPeriod: true, Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: NeedsAttention, Reason: ReasonLegacyGrantWithoutPeriod},
		},
		{
			name:   "a refund of a migrated grant Stripe could not pin down takes nothing once the pool has a later period",
			pool:   Pool{Source: aJune},
			grant:  Grant{WithoutPeriod: true, Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: RecordOnly},
		},
		{
			name:   "nothing is decided before the legacy provenance backfill finishes",
			pool:   Pool{BackfillPending: true},
			grant:  Grant{Applied: 100},
			refund: Refund{Refunded: 500, Captured: 500, Balance: 100},
			want:   Effect{Outcome: WaitDependency, Reason: ReasonBackfillPending},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Clawback(tc.pool, tc.grant, tc.refund)
			if err != nil {
				t.Fatalf("Clawback: %v", err)
			}
			if got != tc.want {
				t.Errorf("Clawback(%+v, %+v, %+v) = %+v, want %+v", tc.pool, tc.grant, tc.refund, got, tc.want)
			}
		})
	}
}

func TestClawbackRefusesAnInvalidRefund(t *testing.T) {
	for _, r := range []Refund{
		{Refunded: 100, Captured: 0},
		{Refunded: -1, Captured: 100},
		{Refunded: 200, Captured: 100},
	} {
		if _, err := Clawback(Pool{Source: aMay}, Grant{Source: aMay, Applied: 100}, r); !errors.Is(err, ErrInvalidRefund) {
			t.Errorf("Clawback with %+v: err = %v, want ErrInvalidRefund", r, err)
		}
	}
}
