package invoicepaid

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/alert"
	"enx-api/billing/attribution"
	"enx-api/billing/creditperiod"
	"enx-api/billing/eligibility"
	"enx-api/billing/invoice"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
)

// Sandbox objects in billing/testdata/stripe-plan-change.
const (
	pricePro     = "price_1UTxL2D98PEpzR2E1f73d4Ln"
	priceProPlus = "price_1UTxL2D98PEpzR2E4lt7hGCN"
	priceMax     = "price_1UTxL2D98PEpzR2EokCgl4jd"
	sandboxSub   = "sub_1UU03ID98PEpzR2EJ2kjpqD1"
	sandboxCus   = "cus_VV03wKkovxzzTP"

	createInvoice = "in_1UU03ID98PEpzR2EMP53Agf8"
	upgradeInv    = "in_1UU03xD98PEpzR2EApWpiDtx"
	renewalInv    = "in_1UU05WD98PEpzR2EOXJkis8z"
)

var (
	// Fixture 02's line: the 31-day period both upgrades fall in.
	firstPeriod = invoice.Period{Start: 1792829501, End: 1795507901}
	// Fixture 15's line: the next period.
	secondPeriod = invoice.Period{Start: 1795507901, End: 1798099901}

	testNow = time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	scope   = webhookevent.Scope{AccountID: "acct_1", EventID: "evt_test"}
)

var plans = Plans{
	TierForPrice: map[string]string{pricePro: "pro", priceProPlus: "pro-plus", priceMax: "max"},
	Credits:      map[string]int64{"pro": 500, "pro-plus": 1500, "max": 4000},
}

type fakeStore struct {
	payload  []byte
	recorded map[string]bool
	subs     map[string]Subscription
	owners   map[string]Owner
	// grants is keyed by Subscription ID and period end.
	grants map[string]creditperiod.Grant
	err    error
}

func (f *fakeStore) Payload(_ context.Context, s webhookevent.Scope) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	if s != scope {
		return nil, fmt.Errorf("payload of %+v, want %+v", s, scope)
	}
	return f.payload, nil
}

func (f *fakeStore) InvoiceRecorded(_ context.Context, id string) (bool, error) {
	return f.recorded[id], f.err
}

func (f *fakeStore) Subscription(_ context.Context, id string) (Subscription, error) {
	return f.subs[id], f.err
}

func (f *fakeStore) Owner(_ context.Context, userID string) (Owner, error) {
	return f.owners[userID], f.err
}

func (f *fakeStore) NormalGrantEndingAt(_ context.Context, subscriptionID string, end int64) (*creditperiod.Grant, error) {
	g, ok := f.grants[fmt.Sprintf("%s/%d", subscriptionID, end)]
	if !ok {
		return nil, f.err
	}
	return &g, f.err
}

type fakeStripe struct {
	statuses map[string]string
	intents  map[string]string
	err      error
	calls    int
}

func (f *fakeStripe) SubscriptionStatus(_ context.Context, id string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	status, ok := f.statuses[id]
	if !ok {
		return "", fmt.Errorf("no Stripe status for %s", id)
	}
	return status, nil
}

func (f *fakeStripe) InvoicePaymentIntent(_ context.Context, id string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.intents[id], nil
}

func fixture(t *testing.T, name string, edits ...string) []byte {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join("..", "testdata", "stripe-plan-change", name))
	if err != nil {
		t.Fatal(err)
	}
	s := string(payload)
	for i := 0; i+1 < len(edits); i += 2 {
		if !strings.Contains(s, edits[i]) {
			t.Fatalf("test edit %q does not apply to %s", edits[i], name)
		}
		s = strings.Replace(s, edits[i], edits[i+1], 1)
	}
	return []byte(s)
}

// withMetadataUser sets the invoice's snapshot of its subscription's
// metadata to enx_user_id=userID, as ENX's Checkout does.
func withMetadataUser(userID string) []string {
	return []string{
		"\"subscription_details\": {\n          \"metadata\": {\n            \"enx_experiment\": \"297\"",
		"\"subscription_details\": {\n          \"metadata\": {\n            \"enx_user_id\": \"" + userID + "\"",
	}
}

func handle(t *testing.T, store *fakeStore, stripe *fakeStripe) webhookevent.Result {
	t.Helper()
	h := NewHandler(store, stripe, plans, func() time.Time { return testNow })
	return h.Handle(context.Background(), webhookevent.StoredTask{
		Scope:      scope,
		APIVersion: "2026-07-29.dahlia",
		Task:       webhookevent.Task{Type: "invoice.paid", SubscriptionID: sandboxSub},
	})
}

func effects(t *testing.T, r webhookevent.Result) Effects {
	t.Helper()
	e, ok := r.Effects.(Effects)
	if !ok {
		t.Fatalf("effects = %#v, want invoicepaid.Effects", r.Effects)
	}
	return e
}

func wantStep(t *testing.T, r webhookevent.Result, step webhookevent.Step, reason string) {
	t.Helper()
	if r.Step != step || r.Reason != reason {
		t.Fatalf("result = step %d reason %q, want step %d reason %q", r.Step, r.Reason, step, reason)
	}
}

func TestFirstInvoiceOfAMetadataSubscriptionIsAcceptedAndGranted(t *testing.T) {
	store := &fakeStore{payload: fixture(t, "02-invoice.paid-subscription_create.json", withMetadataUser("user_1")...)}
	stripe := &fakeStripe{
		statuses: map[string]string{sandboxSub: "active"},
		intents:  map[string]string{createInvoice: "pi_1"},
	}

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	want := Effects{
		Observed:       Observed{SubscriptionID: sandboxSub, OwnerUserID: "user_1"},
		Attribution:    &Attribution{UserID: "user_1", CustomerID: sandboxCus},
		Classification: &Classification{To: acceptance.Accepted},
		Grant: &Grant{
			Kind: NormalGrant, InvoiceID: createInvoice, PaymentIntentID: "pi_1", Tier: "pro",
			Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: firstPeriod}, Purchased: 500, Applied: 500,
		},
		FirstPayment: &referral.FirstPayment{
			Kind: referral.KindSubscription, PaymentIntentID: "pi_1", InvoiceID: createInvoice, Credits: 500,
			PaidAt: time.Unix(1792829506, 0),
		},
	}
	if got := effects(t, r); !reflect.DeepEqual(got, want) {
		t.Fatalf("effects =\n%s\nwant\n%s", describe(got), describe(want))
	}
}

func TestInvoiceOfALegacySubscriptionWaitsForItsCheckout(t *testing.T) {
	store := &fakeStore{payload: fixture(t, "02-invoice.paid-subscription_create.json")}
	stripe := &fakeStripe{statuses: map[string]string{sandboxSub: "active"}}

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.MissingDependency, attribution.ReasonAttributionMissing)
	if r.Effects != nil {
		t.Fatalf("effects = %#v, want none", r.Effects)
	}
}

func TestStoredCheckoutAssociationAttributesALegacySubscription(t *testing.T) {
	store := &fakeStore{
		payload: fixture(t, "02-invoice.paid-subscription_create.json"),
		subs:    map[string]Subscription{sandboxSub: {Known: true, CheckoutUserID: "user_1", Version: 3}},
	}
	stripe := &fakeStripe{statuses: map[string]string{sandboxSub: "active"}}

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	got := effects(t, r)
	if got.Observed != (Observed{SubscriptionID: sandboxSub, SubscriptionKnown: true, SubscriptionVersion: 3, OwnerUserID: "user_1"}) {
		t.Fatalf("observed = %+v", got.Observed)
	}
	if got.Attribution == nil || got.Attribution.UserID != "user_1" {
		t.Fatalf("attribution = %+v, want user_1", got.Attribution)
	}
	if got.Classification == nil || got.Classification.To != acceptance.Accepted || got.Grant == nil || got.Grant.Applied != 500 {
		t.Fatalf("classification %+v, grant %+v; want accepted with 500 applied", got.Classification, got.Grant)
	}
}

func TestContradictoryOwnersNeedAttention(t *testing.T) {
	store := &fakeStore{
		payload: fixture(t, "02-invoice.paid-subscription_create.json", withMetadataUser("user_2")...),
		subs:    map[string]Subscription{sandboxSub: {Known: true, OwnerUserID: "user_1", Classification: acceptance.Accepted}},
	}

	r := handle(t, store, &fakeStripe{})

	wantStep(t, r, webhookevent.Unrecoverable, attribution.ReasonContradictoryUserIdentity)
	if r.Effects != nil {
		t.Fatalf("effects = %#v, want none", r.Effects)
	}
}

func TestOneOffInvoiceHasNoSubscriptionEffect(t *testing.T) {
	store := &fakeStore{payload: fixture(t, "02-invoice.paid-subscription_create.json",
		"\"parent\": {\n        \"quote_details\": null,\n        \"subscription_details\": {", "\"parent_unused\": {\n        \"quote_details\": null,\n        \"subscription_details\": {")}
	stripe := &fakeStripe{}

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.NoEffect, ReasonNotASubscriptionInvoice)
	if r.Effects != nil || stripe.calls != 0 {
		t.Fatalf("effects %#v after %d Stripe calls, want none", r.Effects, stripe.calls)
	}
}

func TestUnreadableInvoicesNeedAttention(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
		reason  string
	}{
		{"an unsupported API version", fixture(t, "02-invoice.paid-subscription_create.json",
			`"api_version": "2026-07-29.dahlia"`, `"api_version": "2025-03-31.basil"`), webhookevent.ReasonUnsupportedAPIVersion},
		{"a payload that is no invoice", fixture(t, "02-invoice.paid-subscription_create.json",
			`"object": "invoice"`, `"object": "credit_note"`), ReasonMalformedInvoice},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := handle(t, &fakeStore{payload: tc.payload}, &fakeStripe{})
			wantStep(t, r, webhookevent.Unrecoverable, tc.reason)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

// firstInvoice is fixture 02 paid by user_1, whose subscription ENX has not
// classified yet, with owner as user_1's billing state.
func firstInvoice(t *testing.T, owner Owner, statuses map[string]string) (*fakeStore, *fakeStripe) {
	t.Helper()
	store := &fakeStore{
		payload: fixture(t, "02-invoice.paid-subscription_create.json", withMetadataUser("user_1")...),
		owners:  map[string]Owner{"user_1": owner},
	}
	return store, &fakeStripe{statuses: statuses, intents: map[string]string{createInvoice: "pi_1"}}
}

func TestCompetingLiveSubscriptionIsAConflictWithAPendingAlertAndNoCredits(t *testing.T) {
	store, stripe := firstInvoice(t,
		Owner{AcceptedID: "sub_a", Revision: 7, Pool: creditperiod.Pool{Source: creditperiod.Source{SubscriptionID: "sub_a", Period: firstPeriod}}},
		map[string]string{sandboxSub: "active", "sub_a": "active"})

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	want := Effects{
		Observed:    Observed{SubscriptionID: sandboxSub, OwnerUserID: "user_1", AcceptedID: "sub_a", Revision: 7},
		Attribution: &Attribution{UserID: "user_1", CustomerID: sandboxCus},
		Classification: &Classification{
			To: acceptance.Conflict, ConflictReason: acceptance.ReasonCompetesWithAccepted, ConflictWith: "sub_a",
			DiscoveredAt: testNow, Alert: alert.Alert{State: alert.Pending, NextAttemptAt: testNow},
		},
	}
	if got := effects(t, r); !reflect.DeepEqual(got, want) {
		t.Fatalf("effects =\n%s\nwant\n%s", describe(got), describe(want))
	}
}

func TestReplacementAfterTheAcceptedSubscriptionEndedIsAcceptedAndInitializesItsPool(t *testing.T) {
	store, stripe := firstInvoice(t,
		Owner{AcceptedID: "sub_a", Revision: 7, Pool: creditperiod.Pool{Source: creditperiod.Source{SubscriptionID: "sub_a", Period: secondPeriod}}},
		map[string]string{sandboxSub: "active", "sub_a": "canceled"})

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	got := effects(t, r)
	if got.Classification == nil || got.Classification.To != acceptance.Accepted {
		t.Fatalf("classification = %+v, want accepted", got.Classification)
	}
	// sub_a's pool runs later than the replacement's first period; periods
	// are compared only within one subscription.
	if got.Grant == nil || got.Grant.Applied != 500 {
		t.Fatalf("grant = %+v, want 500 applied", got.Grant)
	}
}

func TestOwnedConflictsBlockAcceptingAReplacement(t *testing.T) {
	cases := []struct {
		name     string
		owned    eligibility.Owned
		statuses map[string]string
	}{
		{"an open conflict, even after Stripe ended it",
			eligibility.Owned{ID: "sub_c", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"},
			map[string]string{sandboxSub: "active", "sub_a": "canceled"}},
		{"a resolved conflict Stripe still bills",
			eligibility.Owned{ID: "sub_c", Conflict: eligibility.ConflictResolved, StoredStatus: "canceled"},
			map[string]string{sandboxSub: "active", "sub_a": "canceled", "sub_c": "active"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// A stored terminal status needs no lookup, so the resolved case
			// stores a stale active status to force one.
			owned := tc.owned
			if owned.Conflict == eligibility.ConflictResolved {
				owned.StoredStatus = "active"
			}
			store, stripe := firstInvoice(t, Owner{AcceptedID: "sub_a", Owned: []eligibility.Owned{owned}}, tc.statuses)

			r := handle(t, store, stripe)

			wantStep(t, r, webhookevent.Handled, "")
			got := effects(t, r)
			c := got.Classification
			if c == nil || c.To != acceptance.Conflict || c.ConflictReason != acceptance.ReasonBlockedByConflict || c.ConflictWith != "sub_a" || c.Alert.State != alert.Pending {
				t.Fatalf("classification = %+v, want a blocked conflict with a pending alert", c)
			}
			if got.Grant != nil || got.FirstPayment != nil {
				t.Fatalf("grant %+v, first payment %+v; want none", got.Grant, got.FirstPayment)
			}
		})
	}

	t.Run("a resolved conflict Stripe ended does not block", func(t *testing.T) {
		store, stripe := firstInvoice(t,
			Owner{AcceptedID: "sub_a", Owned: []eligibility.Owned{{ID: "sub_c", Conflict: eligibility.ConflictResolved, StoredStatus: "canceled"}}},
			map[string]string{sandboxSub: "active", "sub_a": "canceled"})

		r := handle(t, store, stripe)

		wantStep(t, r, webhookevent.Handled, "")
		if c := effects(t, r).Classification; c == nil || c.To != acceptance.Accepted {
			t.Fatalf("classification = %+v, want accepted", c)
		}
	})
}

func TestPaidInvoiceOfASubscriptionThatEndedBeforeAcceptanceIsStaleAndNeedsAttention(t *testing.T) {
	store, stripe := firstInvoice(t, Owner{}, map[string]string{sandboxSub: "canceled"})

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Unrecoverable, ReasonStaleSubscriptionInvoice)
	got := effects(t, r)
	if got.Classification == nil || got.Classification.To != acceptance.Stale {
		t.Fatalf("classification = %+v, want stale", got.Classification)
	}
	if got.Grant != nil || got.FirstPayment != nil {
		t.Fatalf("grant %+v, first payment %+v; want none", got.Grant, got.FirstPayment)
	}
}

func TestInvoicesOfClassifiedSubscriptionsThatGrantNothing(t *testing.T) {
	cases := []struct {
		name           string
		classification acceptance.Classification
		step           webhookevent.Step
		reason         string
	}{
		{"a conflict's invoice stays investigation context", acceptance.Conflict, webhookevent.Handled, ""},
		{"a stale subscription's invoice needs attention", acceptance.Stale, webhookevent.Unrecoverable, ReasonStaleSubscriptionInvoice},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{
				payload: fixture(t, "02-invoice.paid-subscription_create.json"),
				subs:    map[string]Subscription{sandboxSub: {Known: true, OwnerUserID: "user_1", Classification: tc.classification, Version: 4}},
				owners:  map[string]Owner{"user_1": {AcceptedID: "sub_a", Revision: 2}},
			}
			stripe := &fakeStripe{}

			r := handle(t, store, stripe)

			wantStep(t, r, tc.step, tc.reason)
			want := Effects{Observed: Observed{SubscriptionID: sandboxSub, SubscriptionKnown: true, SubscriptionVersion: 4, OwnerUserID: "user_1", AcceptedID: "sub_a", Revision: 2}}
			if got := effects(t, r); !reflect.DeepEqual(got, want) {
				t.Fatalf("effects =\n%s\nwant\n%s", describe(got), describe(want))
			}
			if stripe.calls != 0 {
				t.Fatalf("%d Stripe calls, want none", stripe.calls)
			}
		})
	}
}

func TestTheDeletionGateStopsAcceptanceAndGrants(t *testing.T) {
	cases := []struct {
		name     string
		deletion acceptance.Deletion
		step     webhookevent.Step
		reason   string
	}{
		{"deletion in progress waits", acceptance.DeletionInProgress, webhookevent.MissingDependency, ReasonDeletionInProgress},
		{"a payment after deletion needs attention", acceptance.DeletionCompleted, webhookevent.Unrecoverable, acceptance.ReasonPaymentAfterAccountDeletion},
	}
	for _, tc := range cases {
		t.Run("new subscription: "+tc.name, func(t *testing.T) {
			store, stripe := firstInvoice(t, Owner{Deletion: tc.deletion}, map[string]string{sandboxSub: "active"})

			r := handle(t, store, stripe)

			wantStep(t, r, tc.step, tc.reason)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
		t.Run("accepted subscription: "+tc.name, func(t *testing.T) {
			store := &fakeStore{
				payload: fixture(t, "15-invoice.paid-subscription_cycle.json"),
				subs:    map[string]Subscription{sandboxSub: {Known: true, OwnerUserID: "user_1", Classification: acceptance.Accepted}},
				owners: map[string]Owner{"user_1": {AcceptedID: sandboxSub, Deletion: tc.deletion,
					Pool: creditperiod.Pool{Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: firstPeriod}}}},
			}

			r := handle(t, store, &fakeStripe{intents: map[string]string{}})

			wantStep(t, r, tc.step, tc.reason)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

// acceptedInvoice is fixture name paid on user_1's accepted subscription
// sandboxSub, with pool as user_1's subscription pool and grants as the
// stored normal grants.
func acceptedInvoice(t *testing.T, name string, pool creditperiod.Pool, grants map[string]creditperiod.Grant, edits ...string) (*fakeStore, *fakeStripe) {
	t.Helper()
	store := &fakeStore{
		payload: fixture(t, name, edits...),
		subs:    map[string]Subscription{sandboxSub: {Known: true, OwnerUserID: "user_1", Classification: acceptance.Accepted, Version: 5}},
		owners:  map[string]Owner{"user_1": {AcceptedID: sandboxSub, Revision: 9, Pool: pool}},
		grants:  grants,
	}
	return store, &fakeStripe{intents: map[string]string{createInvoice: "pi_create", upgradeInv: "pi_upgrade", renewalInv: "pi_renewal"}}
}

func poolOf(p invoice.Period) creditperiod.Pool {
	return creditperiod.Pool{Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: p}}
}

// firstGrant is fixture 02's stored normal grant, the denominator of both
// upgrades in its period.
var firstGrant = map[string]creditperiod.Grant{
	fmt.Sprintf("%s/%d", sandboxSub, firstPeriod.End): {Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: firstPeriod}, Applied: 500},
}

func TestRenewalOfTheAcceptedSubscriptionResetsThePoolToTheLineTier(t *testing.T) {
	store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json", poolOf(firstPeriod), nil)

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	want := Effects{
		Observed: Observed{SubscriptionID: sandboxSub, SubscriptionKnown: true, SubscriptionVersion: 5, OwnerUserID: "user_1", AcceptedID: sandboxSub, Revision: 9},
		Grant: &Grant{
			Kind: NormalGrant, InvoiceID: renewalInv, PaymentIntentID: "pi_renewal", Tier: "pro",
			Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: secondPeriod}, Purchased: 500, Applied: 500,
		},
		FirstPayment: &referral.FirstPayment{
			Kind: referral.KindSubscription, PaymentIntentID: "pi_renewal", InvoiceID: renewalInv, Credits: 500,
			PaidAt: time.Unix(1792829651, 0),
		},
	}
	if got := effects(t, r); !reflect.DeepEqual(got, want) {
		t.Fatalf("effects =\n%s\nwant\n%s", describe(got), describe(want))
	}
}

func TestLateOrHistoricalNormalInvoicesAreRecordedWithZeroPoolEffect(t *testing.T) {
	t.Run("an old period of the accepted subscription", func(t *testing.T) {
		store, stripe := acceptedInvoice(t, "02-invoice.paid-subscription_create.json", poolOf(secondPeriod), nil)

		r := handle(t, store, stripe)

		wantStep(t, r, webhookevent.Handled, "")
		if g := effects(t, r).Grant; g == nil || g.Purchased != 500 || g.Applied != 0 || g.PaymentIntentID != "pi_create" {
			t.Fatalf("grant = %+v, want 500 purchased, 0 applied, with its PaymentIntent", g)
		}
	})
	t.Run("a formerly accepted subscription after its replacement", func(t *testing.T) {
		store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json",
			creditperiod.Pool{Source: creditperiod.Source{SubscriptionID: "sub_b", Period: firstPeriod}}, nil)
		store.owners["user_1"] = Owner{AcceptedID: "sub_b", Pool: store.owners["user_1"].Pool}

		r := handle(t, store, stripe)

		wantStep(t, r, webhookevent.Handled, "")
		if g := effects(t, r).Grant; g == nil || g.Purchased != 500 || g.Applied != 0 {
			t.Fatalf("grant = %+v, want 500 purchased, 0 applied", g)
		}
	})
}

func TestPaidUpgradeAddsItsTopUpOverTheStoredNormalGrantsPeriod(t *testing.T) {
	store, stripe := acceptedInvoice(t, "03-invoice.paid-subscription_update.json", poolOf(firstPeriod), firstGrant)

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	want := &Grant{
		Kind: UpgradeTopUp, InvoiceID: upgradeInv, PaymentIntentID: "pi_upgrade", FromTier: "pro", Tier: "pro-plus",
		// floor((1500 - 500) * 21/31 days)
		Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: firstPeriod}, Purchased: 677, Applied: 677,
	}
	got := effects(t, r)
	if !reflect.DeepEqual(got.Grant, want) {
		t.Fatalf("grant = %+v, want %+v", got.Grant, want)
	}
	if got.FirstPayment == nil || got.FirstPayment.Credits != 677 || got.FirstPayment.InvoiceID != upgradeInv {
		t.Fatalf("first payment = %+v, want the upgrade's 677 credits", got.FirstPayment)
	}
}

func TestUpgradeTopUpDependsOnItsPeriodsNormalGrant(t *testing.T) {
	t.Run("before the normal grant it waits", func(t *testing.T) {
		store, stripe := acceptedInvoice(t, "03-invoice.paid-subscription_update.json", poolOf(firstPeriod), nil)

		r := handle(t, store, stripe)

		wantStep(t, r, webhookevent.MissingDependency, creditperiod.ReasonNormalGrantMissing)
		if r.Effects != nil && effects(t, r).Grant != nil {
			t.Fatalf("grant = %+v, want none", effects(t, r).Grant)
		}
	})
	t.Run("after the pool moved to the next period it is recorded with zero effect", func(t *testing.T) {
		store, stripe := acceptedInvoice(t, "03-invoice.paid-subscription_update.json", poolOf(secondPeriod), firstGrant)

		r := handle(t, store, stripe)

		wantStep(t, r, webhookevent.Handled, "")
		if g := effects(t, r).Grant; g == nil || g.Purchased != 677 || g.Applied != 0 {
			t.Fatalf("grant = %+v, want 677 purchased, 0 applied", g)
		}
	})
	t.Run("a new tier that grants no more credits needs attention", func(t *testing.T) {
		store, stripe := acceptedInvoice(t, "03-invoice.paid-subscription_update.json", poolOf(firstPeriod), firstGrant,
			`"price": "`+pricePro+`"`, `"price": "swap"`,
			`"price": "`+priceProPlus+`"`, `"price": "`+pricePro+`"`,
			`"price": "swap"`, `"price": "`+priceProPlus+`"`)

		r := handle(t, store, stripe)

		wantStep(t, r, webhookevent.Unrecoverable, creditperiod.ReasonUpgradeNotHigher)
		if r.Effects != nil && effects(t, r).Grant != nil {
			t.Fatalf("grant = %+v, want none", effects(t, r).Grant)
		}
	})
}

func TestAnInvoiceAlreadyRecordedChangesNothing(t *testing.T) {
	store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json", poolOf(firstPeriod), nil)
	store.recorded = map[string]bool{renewalInv: true}

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	if r.Effects != nil || stripe.calls != 0 {
		t.Fatalf("effects %#v after %d Stripe calls, want none", r.Effects, stripe.calls)
	}
}

func TestATierWithoutConfiguredCreditsNeedsAttention(t *testing.T) {
	store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json", poolOf(firstPeriod), nil)
	h := NewHandler(store, stripe, Plans{TierForPrice: plans.TierForPrice, Credits: map[string]int64{"pro-plus": 1500}}, func() time.Time { return testNow })

	r := h.Handle(context.Background(), webhookevent.StoredTask{Scope: scope, APIVersion: "2026-07-29.dahlia"})

	wantStep(t, r, webhookevent.Unrecoverable, ReasonTierCreditsUnset)
	if r.Effects != nil && effects(t, r).Grant != nil {
		t.Fatalf("grant = %+v, want none", effects(t, r).Grant)
	}
}

func TestAFreeInvoiceGrantsWithoutAPaymentOrReferral(t *testing.T) {
	store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json", poolOf(firstPeriod), nil,
		`"amount_paid": 399`, `"amount_paid": 0`)
	stripe.err = errors.New("Stripe must not be asked")

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	got := effects(t, r)
	if got.Grant == nil || got.Grant.Applied != 500 || got.Grant.PaymentIntentID != "" || got.FirstPayment != nil {
		t.Fatalf("grant %+v, first payment %+v; want 500 applied with no PaymentIntent or referral", got.Grant, got.FirstPayment)
	}
}

func TestASecondUpgradeInOnePeriodAddsItsOwnDifferenceOverTheSameDenominator(t *testing.T) {
	store, stripe := acceptedInvoice(t, "05-invoice.paid-subscription_update.json", poolOf(firstPeriod), firstGrant)

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	// floor((4000 - 1500) * 16/31 days), leaving Pro+ rather than Pro.
	g := effects(t, r).Grant
	if g == nil || g.Kind != UpgradeTopUp || g.FromTier != "pro-plus" || g.Tier != "max" || g.Purchased != 1290 || g.Applied != 1290 ||
		g.Source != (creditperiod.Source{SubscriptionID: sandboxSub, Period: firstPeriod}) {
		t.Fatalf("grant = %+v, want 1290 Pro+ to Max credits applied to the first period", g)
	}
}

func TestAnInvoiceWithAnUnknownPriceNeedsAttentionBeforeAnyLookup(t *testing.T) {
	store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json", poolOf(firstPeriod), nil,
		`"price": "`+pricePro+`"`, `"price": "price_dashboard_mistake"`)
	stripe.err = errors.New("Stripe must not be asked")

	r := handle(t, store, stripe)

	wantStep(t, r, webhookevent.Unrecoverable, invoice.ReasonUnknownPrice)
	if r.Effects != nil || stripe.calls != 0 {
		t.Fatalf("effects %#v after %d Stripe calls, want none", r.Effects, stripe.calls)
	}
}

func TestFailuresRetryWithoutEffects(t *testing.T) {
	broken := errors.New("connection reset")
	cases := []struct {
		name  string
		setup func(*fakeStore, *fakeStripe)
	}{
		{"the store fails", func(s *fakeStore, _ *fakeStripe) { s.err = broken }},
		{"Stripe fails", func(_ *fakeStore, s *fakeStripe) { s.err = broken }},
		{"a resolved conflict's live state cannot be read", func(s *fakeStore, _ *fakeStripe) {
			s.owners["user_1"] = Owner{Owned: []eligibility.Owned{{ID: "sub_c", Conflict: eligibility.ConflictResolved, StoredStatus: "active"}}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store, stripe := firstInvoice(t, Owner{}, map[string]string{sandboxSub: "active"})
			tc.setup(store, stripe)

			r := handle(t, store, stripe)

			if r.Step != webhookevent.Transient || r.Effects != nil {
				t.Fatalf("result = %+v, want a transient retry with no effects", r)
			}
		})
	}

	t.Run("the PaymentIntent lookup fails", func(t *testing.T) {
		store, stripe := acceptedInvoice(t, "15-invoice.paid-subscription_cycle.json", poolOf(firstPeriod), nil)
		stripe.err = broken

		r := handle(t, store, stripe)

		if r.Step != webhookevent.Transient || r.Effects != nil {
			t.Fatalf("result = %+v, want a transient retry with no effects", r)
		}
	})
}

func describe(e Effects) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  observed %+v\n", e.Observed)
	if e.Attribution != nil {
		fmt.Fprintf(&b, "  attribution %+v\n", *e.Attribution)
	}
	if e.Classification != nil {
		fmt.Fprintf(&b, "  classification %+v\n", *e.Classification)
	}
	if e.Grant != nil {
		fmt.Fprintf(&b, "  grant %+v\n", *e.Grant)
	}
	if e.FirstPayment != nil {
		fmt.Fprintf(&b, "  first payment %+v\n", *e.FirstPayment)
	}
	return b.String()
}
