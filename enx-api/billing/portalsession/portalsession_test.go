package portalsession

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"enx-api/billing/acceptance"
	"enx-api/billing/eligibility"
)

// Sandbox Prices in billing/testdata/stripe-plan-change.
const (
	pricePro     = "price_1UTxL2D98PEpzR2E1f73d4Ln"
	priceProPlus = "price_1UTxL2D98PEpzR2E4lt7hGCN"
	priceMax     = "price_1UTxL2D98PEpzR2EokCgl4jd"

	planChangeConfig = "bpc_change"
	restrictedConfig = "bpc_restricted"
	returnURL        = "https://enx.example/billing"
)

var tierPrices = map[string]string{"pro": pricePro, "pro-plus": priceProPlus, "max": priceMax}

type fakeStore struct {
	owner Owner
	err   error
}

func (f *fakeStore) Owner(_ context.Context, _ string) (Owner, error) {
	return f.owner, f.err
}

type fakeStripe struct {
	subs          map[string]Subscription
	subErr        error
	pricesErr     error
	planChangeErr error
	restrictedErr error
	createErr     error

	reads    []string
	sessions []Session
}

func (f *fakeStripe) Subscription(_ context.Context, id string) (Subscription, error) {
	f.reads = append(f.reads, id)
	if f.subErr != nil {
		return Subscription{}, f.subErr
	}
	sub, ok := f.subs[id]
	if !ok {
		return Subscription{}, errors.New("no such subscription: " + id)
	}
	return sub, nil
}

func (f *fakeStripe) TierPrices(context.Context) (map[string]string, error) {
	return tierPrices, f.pricesErr
}

func (f *fakeStripe) PlanChangeConfiguration(_ context.Context, prices map[string]string) (string, error) {
	if f.planChangeErr != nil {
		return "", f.planChangeErr
	}
	if !reflect.DeepEqual(prices, tierPrices) {
		return "", errors.New("plan-change configuration checked against the wrong tier Prices")
	}
	return planChangeConfig, nil
}

func (f *fakeStripe) RestrictedConfiguration(context.Context) (string, error) {
	return restrictedConfig, f.restrictedErr
}

func (f *fakeStripe) CreateSession(_ context.Context, s Session) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	f.sessions = append(f.sessions, s)
	return "https://billing.stripe.com/p/session/test", nil
}

// on is a subscription with one item, si_<id>, on priceID.
func on(id, priceID string, live eligibility.Live) Subscription {
	return Subscription{Live: live, Items: []Item{{ID: "si_" + id, PriceID: priceID}}, ItemsComplete: true}
}

var active = eligibility.Live{Status: "active", CurrentPeriodEnd: 1795507901}

// subscriber accepts sub_a on Customer cus_a; the user's normal Customer
// is cus_normal.
func subscriber(owned ...eligibility.Owned) Owner {
	return Owner{
		Owned:              append([]eligibility.Owned{{ID: "sub_a", StoredStatus: "active"}}, owned...),
		AcceptedID:         "sub_a",
		AcceptedCustomerID: "cus_a",
		CustomerID:         "cus_normal",
	}
}

func onlySession(t *testing.T, f *fakeStripe) Session {
	t.Helper()
	if len(f.sessions) != 1 {
		t.Fatalf("created %d sessions, want 1", len(f.sessions))
	}
	return f.sessions[0]
}

func TestAnUnblockedSubscribersPortalHomeUsesThePlanChangeConfiguration(t *testing.T) {
	stripe := &fakeStripe{subs: map[string]Subscription{"sub_a": on("sub_a", pricePro, active)}}

	url, err := New(&fakeStore{owner: subscriber()}, stripe, returnURL).Home(context.Background(), "u1")

	if err != nil || url == "" {
		t.Fatalf("Home = %q, %v; want a session URL", url, err)
	}
	want := Session{CustomerID: "cus_a", ConfigurationID: planChangeConfig, ReturnURL: returnURL}
	if got := onlySession(t, stripe); !reflect.DeepEqual(got, want) {
		t.Errorf("session = %+v, want %+v", got, want)
	}
}

func TestABlockedUsersPortalHomeUsesTheRestrictedConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name  string
		owner Owner
		subs  map[string]Subscription
	}{
		{
			name:  "deletion in progress",
			owner: func() Owner { o := subscriber(); o.Deletion = acceptance.DeletionInProgress; return o }(),
			subs:  map[string]Subscription{"sub_a": on("sub_a", pricePro, active)},
		},
		{
			name:  "an open conflict",
			owner: subscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"}),
			subs:  map[string]Subscription{"sub_a": on("sub_a", pricePro, active)},
		},
		{
			name:  "a resolved conflict Stripe still bills",
			owner: subscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictResolved, StoredStatus: "active"}),
			subs: map[string]Subscription{
				"sub_a": on("sub_a", pricePro, active),
				"sub_b": on("sub_b", priceMax, eligibility.Live{Status: "past_due"}),
			},
		},
		{
			name:  "an accepted subscription that is billable but not healthy",
			owner: subscriber(),
			subs:  map[string]Subscription{"sub_a": on("sub_a", pricePro, eligibility.Live{Status: "past_due"})},
		},
		{
			name:  "an unpaid accepted subscription",
			owner: subscriber(),
			subs:  map[string]Subscription{"sub_a": on("sub_a", pricePro, eligibility.Live{Status: "unpaid"})},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stripe := &fakeStripe{subs: tc.subs}

			_, err := New(&fakeStore{owner: tc.owner}, stripe, returnURL).Home(context.Background(), "u1")

			if err != nil {
				t.Fatalf("Home: %v", err)
			}
			want := Session{CustomerID: "cus_a", ConfigurationID: restrictedConfig, ReturnURL: returnURL}
			if got := onlySession(t, stripe); !reflect.DeepEqual(got, want) {
				t.Errorf("session = %+v, want %+v", got, want)
			}
		})
	}
}

func TestWithoutALiveAcceptedSubscriptionThePortalOpensTheUsersNormalCustomer(t *testing.T) {
	for _, tc := range []struct {
		name  string
		owner Owner
		subs  map[string]Subscription
	}{
		{name: "a top-up buyer with no subscription", owner: Owner{CustomerID: "cus_normal"}},
		{
			name:  "an accepted subscription Stripe has ended",
			owner: subscriber(),
			subs:  map[string]Subscription{"sub_a": on("sub_a", pricePro, eligibility.Live{Status: "canceled"})},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stripe := &fakeStripe{subs: tc.subs}

			_, err := New(&fakeStore{owner: tc.owner}, stripe, returnURL).Home(context.Background(), "u1")

			if err != nil {
				t.Fatalf("Home: %v", err)
			}
			want := Session{CustomerID: "cus_normal", ConfigurationID: planChangeConfig, ReturnURL: returnURL}
			if got := onlySession(t, stripe); !reflect.DeepEqual(got, want) {
				t.Errorf("session = %+v, want %+v", got, want)
			}
		})
	}
}

func TestAUserWithNoStripeCustomerGetsNoPortalSession(t *testing.T) {
	stripe := &fakeStripe{}

	url, err := New(&fakeStore{}, stripe, returnURL).Home(context.Background(), "u1")

	if !errors.Is(err, ErrNoCustomer) {
		t.Errorf("Home = %q, %v; want ErrNoCustomer", url, err)
	}
	if len(stripe.sessions) != 0 {
		t.Errorf("created sessions %+v, want none", stripe.sessions)
	}
}

func TestAFailedLookupCreatesNoPortalHomeSession(t *testing.T) {
	healthy := map[string]Subscription{"sub_a": on("sub_a", pricePro, active)}
	resolvedConflict := subscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictResolved, StoredStatus: "active"})
	deleting := subscriber()
	deleting.Deletion = acceptance.DeletionInProgress
	boom := errors.New("boom")

	for _, tc := range []struct {
		name   string
		store  *fakeStore
		stripe *fakeStripe
	}{
		{name: "the store", store: &fakeStore{err: boom}, stripe: &fakeStripe{subs: healthy}},
		{name: "the accepted subscription", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subErr: boom}},
		{name: "a resolved conflict's live state", store: &fakeStore{owner: resolvedConflict}, stripe: &fakeStripe{subs: healthy}},
		{name: "the tier Prices", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subs: healthy, pricesErr: boom}},
		{name: "the plan-change configuration", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subs: healthy, planChangeErr: boom}},
		{name: "the restricted configuration, with no fallback", store: &fakeStore{owner: deleting}, stripe: &fakeStripe{subs: healthy, restrictedErr: boom}},
		{name: "the session", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subs: healthy, createErr: boom}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			url, err := New(tc.store, tc.stripe, returnURL).Home(context.Background(), "u1")

			if !errors.Is(err, ErrUnavailable) {
				t.Errorf("Home = %q, %v; want ErrUnavailable", url, err)
			}
			if len(tc.stripe.sessions) != 0 {
				t.Errorf("created sessions %+v, want none", tc.stripe.sessions)
			}
		})
	}
}

func TestAHealthySubscribersOtherTierCardOpensTheSubscriptionUpdateConfirmDeepLink(t *testing.T) {
	stripe := &fakeStripe{subs: map[string]Subscription{"sub_a": on("sub_a", pricePro, active)}}

	url, err := New(&fakeStore{owner: subscriber()}, stripe, returnURL).PlanChange(context.Background(), "u1", "max")

	if err != nil || url == "" {
		t.Fatalf("PlanChange = %q, %v; want a session URL", url, err)
	}
	want := Session{
		CustomerID:      "cus_a",
		ConfigurationID: planChangeConfig,
		ReturnURL:       returnURL,
		PlanChange:      &PlanChange{SubscriptionID: "sub_a", ItemID: "si_sub_a", PriceID: priceMax},
	}
	if got := onlySession(t, stripe); !reflect.DeepEqual(got, want) {
		t.Errorf("session = %+v, want %+v", got, want)
	}
}

func TestThePlanChangeIsRefusedWhenTheRulesRefuseIt(t *testing.T) {
	healthy := map[string]Subscription{"sub_a": on("sub_a", pricePro, active)}
	deleting := subscriber()
	deleting.Deletion = acceptance.DeletionInProgress

	for _, tc := range []struct {
		name       string
		owner      Owner
		subs       map[string]Subscription
		tier       string
		want       error
		wantReason string
	}{
		{name: "deletion in progress", owner: deleting, subs: healthy, tier: "max", want: ErrBlocked, wantReason: eligibility.ReasonDeletionInProgress},
		{
			name:  "an open conflict, though the accepted subscription is healthy",
			owner: subscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"}),
			subs:  healthy, tier: "max", want: ErrBlocked, wantReason: eligibility.ReasonSubscriptionConflict,
		},
		{name: "no accepted subscription: subscribe through Checkout", owner: Owner{CustomerID: "cus_normal"}, tier: "max", want: ErrNotAPlanChange},
		{
			name:  "an accepted subscription Stripe has ended: subscribe through Checkout",
			owner: subscriber(),
			subs:  map[string]Subscription{"sub_a": on("sub_a", pricePro, eligibility.Live{Status: "canceled"})},
			tier:  "max", want: ErrNotAPlanChange,
		},
		{name: "the current tier", owner: subscriber(), subs: healthy, tier: "pro", want: ErrNotAPlanChange},
		{name: "a tier ENX does not offer", owner: subscriber(), subs: healthy, tier: "ultra", want: ErrUnknownTier},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stripe := &fakeStripe{subs: tc.subs}

			url, err := New(&fakeStore{owner: tc.owner}, stripe, returnURL).PlanChange(context.Background(), "u1", tc.tier)

			if !errors.Is(err, tc.want) {
				t.Fatalf("PlanChange = %q, %v; want %v", url, err, tc.want)
			}
			if tc.wantReason != "" {
				var blocked *BlockedError
				if !errors.As(err, &blocked) || blocked.Reason != tc.wantReason {
					t.Errorf("PlanChange error = %v, want reason %s", err, tc.wantReason)
				}
			}
			if len(stripe.sessions) != 0 {
				t.Errorf("created sessions %+v, want none", stripe.sessions)
			}
		})
	}
}

func TestABlockedPlanChangeCarriesTheSmallestBlockingSubscriptionIDOnlyForAConflict(t *testing.T) {
	healthy := map[string]Subscription{"sub_a": on("sub_a", pricePro, active)}
	conflicted := subscriber(
		eligibility.Owned{ID: "sub_z", Conflict: eligibility.ConflictOpen, StoredStatus: "active"},
		eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"},
	)
	deleting := conflicted
	deleting.Deletion = acceptance.DeletionInProgress

	for _, tc := range []struct {
		name  string
		owner Owner
		want  string
	}{
		{name: "a conflict names the smallest blocker, not the accepted subscription", owner: conflicted, want: "sub_b"},
		{name: "deletion takes precedence and names none", owner: deleting, want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := New(&fakeStore{owner: tc.owner}, &fakeStripe{subs: healthy}, returnURL).PlanChange(context.Background(), "u1", "max")

			var blocked *BlockedError
			if !errors.As(err, &blocked) || blocked.SubscriptionID != tc.want {
				t.Fatalf("PlanChange error = %v, want BlockedError with SubscriptionID %q", err, tc.want)
			}
		})
	}
}

func TestATierCardOpensThePortalHomeWhileStripeHoldsAChangeOrThePaymentNeedsRecovery(t *testing.T) {
	for _, tc := range []struct {
		name       string
		live       eligibility.Live
		wantConfig string
	}{
		{name: "an upgrade waiting for payment", live: eligibility.Live{Status: "active", PendingUpdate: true}, wantConfig: planChangeConfig},
		{name: "a scheduled downgrade", live: eligibility.Live{Status: "active", HasSchedule: true}, wantConfig: planChangeConfig},
		{name: "a period-end cancellation", live: eligibility.Live{Status: "active", CancelAtPeriodEnd: true}, wantConfig: planChangeConfig},
		{name: "a flexible-mode cancel_at by period end", live: eligibility.Live{Status: "active", CancelAt: 1795507901, CurrentPeriodEnd: 1795507901}, wantConfig: planChangeConfig},
		{name: "a past-due payment, restricted", live: eligibility.Live{Status: "past_due"}, wantConfig: restrictedConfig},
		{name: "an unpaid subscription, restricted", live: eligibility.Live{Status: "unpaid"}, wantConfig: restrictedConfig},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stripe := &fakeStripe{subs: map[string]Subscription{"sub_a": on("sub_a", pricePro, tc.live)}}

			_, err := New(&fakeStore{owner: subscriber()}, stripe, returnURL).PlanChange(context.Background(), "u1", "max")

			if err != nil {
				t.Fatalf("PlanChange: %v", err)
			}
			want := Session{CustomerID: "cus_a", ConfigurationID: tc.wantConfig, ReturnURL: returnURL}
			if got := onlySession(t, stripe); !reflect.DeepEqual(got, want) {
				t.Errorf("session = %+v, want the Portal home %+v", got, want)
			}
		})
	}
}

func TestAHealthySubscriptionWithoutASingleTierPriceGetsNoPlanChange(t *testing.T) {
	for _, tc := range []struct {
		name string
		sub  Subscription
	}{
		{name: "a Price outside ENX's tiers", sub: on("sub_a", "price_dashboard_mistake", active)},
		{name: "two items", sub: Subscription{Live: active, Items: []Item{{ID: "si_1", PriceID: pricePro}, {ID: "si_2", PriceID: priceMax}}, ItemsComplete: true}},
		{name: "more items than Stripe returned", sub: Subscription{Live: active, Items: []Item{{ID: "si_1", PriceID: pricePro}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stripe := &fakeStripe{subs: map[string]Subscription{"sub_a": tc.sub}}

			url, err := New(&fakeStore{owner: subscriber()}, stripe, returnURL).PlanChange(context.Background(), "u1", "max")

			if !errors.Is(err, ErrUnknownSubscriptionPrice) {
				t.Errorf("PlanChange = %q, %v; want ErrUnknownSubscriptionPrice", url, err)
			}
			if len(stripe.sessions) != 0 {
				t.Errorf("created sessions %+v, want none", stripe.sessions)
			}
		})
	}
}

func TestAFailedLookupCreatesNoPlanChangeSession(t *testing.T) {
	healthy := map[string]Subscription{"sub_a": on("sub_a", pricePro, active)}
	resolvedConflict := subscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictResolved, StoredStatus: "active"})
	boom := errors.New("boom")

	for _, tc := range []struct {
		name   string
		store  *fakeStore
		stripe *fakeStripe
	}{
		{name: "the store", store: &fakeStore{err: boom}, stripe: &fakeStripe{subs: healthy}},
		{name: "the accepted subscription", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subErr: boom}},
		{name: "a resolved conflict's live state", store: &fakeStore{owner: resolvedConflict}, stripe: &fakeStripe{subs: healthy}},
		{name: "the tier Prices", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subs: healthy, pricesErr: boom}},
		{name: "the plan-change configuration, with no fallback", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subs: healthy, planChangeErr: boom}},
		{name: "the session", store: &fakeStore{owner: subscriber()}, stripe: &fakeStripe{subs: healthy, createErr: boom}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			url, err := New(tc.store, tc.stripe, returnURL).PlanChange(context.Background(), "u1", "max")

			if !errors.Is(err, ErrUnavailable) {
				t.Errorf("PlanChange = %q, %v; want ErrUnavailable", url, err)
			}
			if len(tc.stripe.sessions) != 0 {
				t.Errorf("created sessions %+v, want none", tc.stripe.sessions)
			}
		})
	}
}
