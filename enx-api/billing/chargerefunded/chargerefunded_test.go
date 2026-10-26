package chargerefunded

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"enx-api/billing/acceptance"
	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
	"enx-api/billing/webhookevent"
)

const (
	chargeID  = "ch_1"
	paymentID = "pi_1"
	userID    = "user_1"
)

var (
	scope = webhookevent.Scope{AccountID: "acct_1", EventID: "evt_refund"}
	aMay  = creditperiod.Source{SubscriptionID: "sub_a", Period: invoice.Period{Start: 1000, End: 2000}}
	aJune = creditperiod.Source{SubscriptionID: "sub_a", Period: invoice.Period{Start: 2000, End: 3000}}
	bMay  = creditperiod.Source{SubscriptionID: "sub_b", Period: invoice.Period{Start: 1500, End: 2500}}
)

// charge is the data.object of a dahlia charge.refunded event.
type charge map[string]any

func refundedCharge(refunded, captured int64) charge {
	return charge{
		"id": chargeID, "object": "charge", "payment_intent": paymentID,
		"amount_refunded": refunded, "amount_captured": captured, "currency": "usd",
	}
}

func (c charge) with(key string, value any) charge {
	out := charge{}
	for k, v := range c {
		out[k] = v
	}
	out[key] = value
	return out
}

func payload(t *testing.T, apiVersion string, object any) []byte {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"id": scope.EventID, "object": "event", "type": "charge.refunded",
		"api_version": apiVersion, "created": 1792829506, "livemode": false,
		"data": map[string]any{"object": object},
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type fakeStore struct {
	payload  []byte
	grants   map[string]Grant
	recorded bool
	owners   map[string]Owner

	payloadErr, grantErr, recordedErr, ownerErr error
}

func (f *fakeStore) Payload(_ context.Context, s webhookevent.Scope) ([]byte, error) {
	if f.payloadErr != nil {
		return nil, f.payloadErr
	}
	if s != scope {
		return nil, fmt.Errorf("payload of %+v, want %+v", s, scope)
	}
	return f.payload, nil
}

func (f *fakeStore) GrantForPaymentIntent(_ context.Context, id string) (Grant, bool, error) {
	if f.grantErr != nil {
		return Grant{}, false, f.grantErr
	}
	g, ok := f.grants[id]
	return g, ok, nil
}

func (f *fakeStore) ClawbackRecorded(_ context.Context, s webhookevent.Scope) (bool, error) {
	if f.recordedErr != nil {
		return false, f.recordedErr
	}
	if s != scope {
		return false, fmt.Errorf("clawback of %+v, want %+v", s, scope)
	}
	return f.recorded, nil
}

func (f *fakeStore) Owner(_ context.Context, id string) (Owner, error) {
	if f.ownerErr != nil {
		return Owner{}, f.ownerErr
	}
	return f.owners[id], nil
}

type fakeStripe struct {
	statuses  map[string]string
	cancelled []string
	statusErr error
	cancelErr error
}

func (f *fakeStripe) SubscriptionStatus(_ context.Context, id string) (string, error) {
	if f.statusErr != nil {
		return "", f.statusErr
	}
	status, ok := f.statuses[id]
	if !ok {
		return "", fmt.Errorf("no subscription %s", id)
	}
	return status, nil
}

func (f *fakeStripe) CancelSubscriptionNow(_ context.Context, id string) error {
	if f.cancelErr != nil {
		return f.cancelErr
	}
	f.cancelled = append(f.cancelled, id)
	return nil
}

func topUpGrant(taken int64) Grant {
	return Grant{ID: "grant_topup", UserID: userID, Pool: PoolTopUp, Credits: 300, Taken: taken}
}

func subscriptionGrant(source creditperiod.Source, applied int64) Grant {
	return Grant{
		ID: "grant_sub", UserID: userID, Pool: PoolSubscription,
		Period: creditperiod.Grant{Source: source, Applied: applied},
	}
}

func storeWith(t *testing.T, object any, g Grant, owner Owner) *fakeStore {
	t.Helper()
	g.Revision = owner.Revision
	return &fakeStore{
		payload: payload(t, "2026-08-26.dahlia", object),
		grants:  map[string]Grant{paymentID: g},
		owners:  map[string]Owner{userID: owner},
	}
}

func handle(store *fakeStore, stripe *fakeStripe) webhookevent.Result {
	return NewHandler(store, stripe).Handle(context.Background(), webhookevent.StoredTask{
		Scope:      scope,
		APIVersion: "2026-08-26.dahlia",
		Task:       webhookevent.Task{Type: "charge.refunded"},
	})
}

func wantStep(t *testing.T, r webhookevent.Result, step webhookevent.Step, reason string) {
	t.Helper()
	if r.Step != step || r.Reason != reason {
		t.Fatalf("result = step %d reason %q, want step %d reason %q", r.Step, r.Reason, step, reason)
	}
}

func wantEffects(t *testing.T, r webhookevent.Result, want Effects) {
	t.Helper()
	got, ok := r.Effects.(Effects)
	if !ok {
		t.Fatalf("effects = %#v, want chargerefunded.Effects", r.Effects)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("effects =\n%s\nwant\n%s", describe(got), describe(want))
	}
}

func wantNoEffects(t *testing.T, r webhookevent.Result) {
	t.Helper()
	if r.Effects != nil {
		t.Fatalf("effects = %#v, want none", r.Effects)
	}
}

func wantCancelled(t *testing.T, stripe *fakeStripe, want ...string) {
	t.Helper()
	if !reflect.DeepEqual(stripe.cancelled, want) && (len(stripe.cancelled) != 0 || len(want) != 0) {
		t.Fatalf("cancelled = %v, want %v", stripe.cancelled, want)
	}
}

func describe(e Effects) string {
	b, _ := json.MarshalIndent(e, "", "  ")
	return string(b)
}

func TestATopUpRefundTakesItsProportionalShareWithoutTouchingSubscriptions(t *testing.T) {
	stripe := &fakeStripe{}
	r := handle(storeWith(t, refundedCharge(500, 1000), topUpGrant(0), Owner{Revision: 4}), stripe)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed: Observed{UserID: userID, Revision: 4, GrantID: "grant_topup"},
		Clawback: &Clawback{
			GrantID: "grant_topup", UserID: userID, Pool: PoolTopUp, Credits: 150,
			ChargeID: chargeID, Refunded: 500, Captured: 1000,
		},
	})
	wantCancelled(t, stripe)
}

func TestCumulativeRefundsTakeOnlyWhatEarlierClawbacksDidNot(t *testing.T) {
	cases := []struct {
		name     string
		refunded int64
		taken    int64
		want     int64
	}{
		// 30% then 100% of a 300-credit top-up: 90, then the remaining 210.
		{name: "a full refund after a 30% one takes the rest", refunded: 1000, taken: 90, want: 210},
		{name: "an earlier smaller refund delivered late hands nothing back", refunded: 300, taken: 300, want: 0},
		{name: "another Event ID of the same refund takes nothing again", refunded: 300, taken: 90, want: 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := handle(storeWith(t, refundedCharge(c.refunded, 1000), topUpGrant(c.taken), Owner{Revision: 4}), &fakeStripe{})

			wantStep(t, r, webhookevent.Handled, "")
			wantEffects(t, r, Effects{
				Observed: Observed{UserID: userID, Revision: 4, GrantID: "grant_topup", Taken: c.taken},
				Clawback: &Clawback{
					GrantID: "grant_topup", UserID: userID, Pool: PoolTopUp, Credits: c.want,
					ChargeID: chargeID, Refunded: c.refunded, Captured: 1000,
				},
			})
		})
	}
}

func TestASubscriptionRefundClawsBackThePoolsGrantAndEndsItsSubscription(t *testing.T) {
	stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
	owner := Owner{Revision: 7, Pool: creditperiod.Pool{Source: aMay}, SubscriptionBalance: 600}
	r := handle(storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(aMay, 1000), owner), stripe)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed: Observed{UserID: userID, Revision: 7, GrantID: "grant_sub", SubscriptionBalance: 600},
		Clawback: &Clawback{
			GrantID: "grant_sub", UserID: userID, Pool: PoolSubscription, Credits: 600,
			ChargeID: chargeID, Refunded: 2000, Captured: 2000,
		},
	})
	wantCancelled(t, stripe, "sub_a")
}

func TestARefundOfAnotherPeriodOrSubscriptionTakesNothingAndEndsOnlyTheRefundedOne(t *testing.T) {
	cases := []struct {
		name string
		pool creditperiod.Source
	}{
		{name: "the pool has moved to a later period of the same subscription", pool: aJune},
		{name: "the pool comes from the replacement subscription", pool: bMay},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active", "sub_b": "active"}}
			owner := Owner{Revision: 7, Pool: creditperiod.Pool{Source: c.pool}, SubscriptionBalance: 600}
			r := handle(storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(aMay, 1000), owner), stripe)

			wantStep(t, r, webhookevent.Handled, "")
			wantEffects(t, r, Effects{
				Observed: Observed{UserID: userID, Revision: 7, GrantID: "grant_sub", SubscriptionBalance: 600},
				Clawback: &Clawback{
					GrantID: "grant_sub", UserID: userID, Pool: PoolSubscription, Credits: 0,
					ChargeID: chargeID, Refunded: 2000, Captured: 2000,
				},
			})
			wantCancelled(t, stripe, "sub_a")
		})
	}
}

func TestOnlyALiveRefundedSubscriptionIsCancelled(t *testing.T) {
	cases := []struct {
		status string
		cancel bool
	}{
		{status: "active", cancel: true},
		{status: "trialing", cancel: true},
		{status: "past_due", cancel: true},
		{status: "canceled", cancel: false},
		{status: "incomplete_expired", cancel: false},
		{status: "unpaid", cancel: false},
		{status: "incomplete", cancel: false},
	}
	for _, c := range cases {
		t.Run(c.status, func(t *testing.T) {
			stripe := &fakeStripe{statuses: map[string]string{"sub_a": c.status}}
			owner := Owner{Revision: 7, Pool: creditperiod.Pool{Source: aMay}, SubscriptionBalance: 600}
			r := handle(storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(aMay, 1000), owner), stripe)

			wantStep(t, r, webhookevent.Handled, "")
			if c.cancel {
				wantCancelled(t, stripe, "sub_a")
			} else {
				wantCancelled(t, stripe)
			}
		})
	}
}

func TestAFailedCancellationCommitsTheClawbackAndRetriesOnlyTheCancellation(t *testing.T) {
	cases := []struct {
		name   string
		stripe *fakeStripe
	}{
		{name: "the status lookup fails", stripe: &fakeStripe{statusErr: errors.New("stripe: 503")}},
		{name: "the cancellation fails", stripe: &fakeStripe{statuses: map[string]string{"sub_a": "active"}, cancelErr: errors.New("stripe: 503")}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			owner := Owner{Revision: 7, Pool: creditperiod.Pool{Source: aMay}, SubscriptionBalance: 600}
			store := storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(aMay, 1000), owner)
			r := handle(store, c.stripe)

			wantStep(t, r, webhookevent.Transient, ReasonCancellationPending+": stripe: 503")
			wantEffects(t, r, Effects{
				Observed: Observed{UserID: userID, Revision: 7, GrantID: "grant_sub", SubscriptionBalance: 600},
				Clawback: &Clawback{
					GrantID: "grant_sub", UserID: userID, Pool: PoolSubscription, Credits: 600,
					ChargeID: chargeID, Refunded: 2000, Captured: 2000,
				},
			})

			// The clawback committed; the retry only cancels.
			store.recorded = true
			store.owners[userID] = Owner{Revision: 8, Pool: creditperiod.Pool{Source: aMay}}
			stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
			r = handle(store, stripe)

			wantStep(t, r, webhookevent.Handled, "")
			wantNoEffects(t, r)
			wantCancelled(t, stripe, "sub_a")
		})
	}
}

func TestARecordedTopUpClawbackIsNotTakenAgain(t *testing.T) {
	store := storeWith(t, refundedCharge(500, 1000), topUpGrant(150), Owner{Revision: 4})
	store.recorded = true
	stripe := &fakeStripe{}
	r := handle(store, stripe)

	wantStep(t, r, webhookevent.Handled, "")
	wantNoEffects(t, r)
	wantCancelled(t, stripe)
}

func TestARefundBeforeItsGrantWaits(t *testing.T) {
	store := storeWith(t, refundedCharge(500, 1000), topUpGrant(0), Owner{})
	store.grants = nil
	stripe := &fakeStripe{}
	r := handle(store, stripe)

	wantStep(t, r, webhookevent.MissingDependency, ReasonRefundGrantMissing)
	wantNoEffects(t, r)
	wantCancelled(t, stripe)
}

func TestARefundOfAnOldGrantWithNoSubscriptionNeedsAttentionWithoutCancelling(t *testing.T) {
	stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
	owner := Owner{Revision: 7, Pool: creditperiod.Pool{Source: aMay}, SubscriptionBalance: 600}
	r := handle(storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(creditperiod.Source{}, 1000), owner), stripe)

	wantStep(t, r, webhookevent.Unrecoverable, ReasonRefundedSubscriptionUnknown)
	wantEffects(t, r, Effects{
		Observed: Observed{UserID: userID, Revision: 7, GrantID: "grant_sub", SubscriptionBalance: 600},
		Clawback: &Clawback{
			GrantID: "grant_sub", UserID: userID, Pool: PoolSubscription, Credits: 0,
			ChargeID: chargeID, Refunded: 2000, Captured: 2000,
		},
	})
	wantCancelled(t, stripe)
}

func TestARefundBeforeTheLegacyBackfillWaitsWithoutEffects(t *testing.T) {
	stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
	owner := Owner{Revision: 7, Pool: creditperiod.Pool{BackfillPending: true}, SubscriptionBalance: 600}
	r := handle(storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(aMay, 1000), owner), stripe)

	wantStep(t, r, webhookevent.MissingDependency, creditperiod.ReasonBackfillPending)
	wantNoEffects(t, r)
	wantCancelled(t, stripe)
}

// A migrated grant Stripe could not pin to a period may still supply the
// pool, so no credits are taken on a guess; its subscription is known, so it
// is still ended.
func TestALegacyGrantWithoutPeriodTakesNothingButEndsItsSubscription(t *testing.T) {
	migrated := creditperiod.Source{SubscriptionID: "sub_a", Period: invoice.Period{End: 2000}}
	legacyStore := func(t *testing.T) *fakeStore {
		g := subscriptionGrant(migrated, 1000)
		g.Period.WithoutPeriod = true
		owner := Owner{Revision: 7, Pool: creditperiod.Pool{Source: migrated, WithoutPeriod: true}, SubscriptionBalance: 600}
		return storeWith(t, refundedCharge(2000, 2000), g, owner)
	}

	t.Run("the cancellation succeeds", func(t *testing.T) {
		stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
		r := handle(legacyStore(t), stripe)

		wantStep(t, r, webhookevent.Unrecoverable, creditperiod.ReasonLegacyGrantWithoutPeriod)
		wantNoEffects(t, r)
		wantCancelled(t, stripe, "sub_a")
	})

	for _, c := range []struct {
		name   string
		stripe *fakeStripe
	}{
		{name: "the status lookup fails", stripe: &fakeStripe{statusErr: errors.New("stripe: 503")}},
		{name: "the cancellation fails", stripe: &fakeStripe{statuses: map[string]string{"sub_a": "active"}, cancelErr: errors.New("stripe: 503")}},
	} {
		t.Run(c.name, func(t *testing.T) {
			store := legacyStore(t)
			r := handle(store, c.stripe)

			wantStep(t, r, webhookevent.Transient, ReasonCancellationPending+": stripe: 503")
			wantNoEffects(t, r)

			stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
			r = handle(store, stripe)

			wantStep(t, r, webhookevent.Unrecoverable, creditperiod.ReasonLegacyGrantWithoutPeriod)
			wantNoEffects(t, r)
			wantCancelled(t, stripe, "sub_a")
		})
	}
}

func TestDuringDeletionTheRefundWaitsWithoutEffects(t *testing.T) {
	stripe := &fakeStripe{statuses: map[string]string{"sub_a": "active"}}
	owner := Owner{Revision: 7, Deletion: acceptance.DeletionInProgress, Pool: creditperiod.Pool{Source: aMay}, SubscriptionBalance: 600}
	r := handle(storeWith(t, refundedCharge(2000, 2000), subscriptionGrant(aMay, 1000), owner), stripe)

	wantStep(t, r, webhookevent.MissingDependency, ReasonDeletionInProgress)
	wantNoEffects(t, r)
	wantCancelled(t, stripe)
}

func TestARefundAfterDeletionIsRecordedWithoutTakingCredits(t *testing.T) {
	cases := []struct {
		name  string
		grant Grant
		pool  Pool
	}{
		{name: "top-up", grant: topUpGrant(0), pool: PoolTopUp},
		{name: "subscription", grant: subscriptionGrant(aMay, 1000), pool: PoolSubscription},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stripe := &fakeStripe{statuses: map[string]string{"sub_a": "canceled"}}
			owner := Owner{Revision: 9, Deletion: acceptance.DeletionCompleted}
			r := handle(storeWith(t, refundedCharge(1000, 1000), c.grant, owner), stripe)

			wantStep(t, r, webhookevent.Handled, "")
			wantEffects(t, r, Effects{
				Observed: Observed{UserID: userID, Revision: 9, GrantID: c.grant.ID},
				Clawback: &Clawback{
					GrantID: c.grant.ID, UserID: userID, Pool: c.pool, Credits: 0,
					ChargeID: chargeID, Refunded: 1000, Captured: 1000,
				},
			})
			wantCancelled(t, stripe)
		})
	}
}

func TestUnreadableRefundsNeedAttention(t *testing.T) {
	cases := []struct {
		name       string
		apiVersion string
		object     any
		reason     string
	}{
		{name: "unsupported API version", apiVersion: "2025-03-31.basil", object: refundedCharge(500, 1000), reason: webhookevent.ReasonUnsupportedAPIVersion},
		{name: "not a charge", apiVersion: "2026-08-26.dahlia", object: refundedCharge(500, 1000).with("object", "refund"), reason: ReasonMalformedCharge},
		{name: "refunded more than captured", apiVersion: "2026-08-26.dahlia", object: refundedCharge(1500, 1000), reason: ReasonMalformedCharge},
		{name: "nothing captured", apiVersion: "2026-08-26.dahlia", object: refundedCharge(0, 0), reason: ReasonMalformedCharge},
		{name: "no PaymentIntent", apiVersion: "2026-07-29.dahlia", object: refundedCharge(500, 1000).with("payment_intent", nil), reason: ReasonRefundWithoutPaymentIntent},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			store := storeWith(t, c.object, topUpGrant(0), Owner{Revision: 4})
			store.payload = payload(t, c.apiVersion, c.object)
			r := handle(store, &fakeStripe{})

			wantStep(t, r, webhookevent.Unrecoverable, c.reason)
			wantNoEffects(t, r)
		})
	}
}

func TestAnExpandedPaymentIntentIsRead(t *testing.T) {
	object := refundedCharge(500, 1000).with("payment_intent", map[string]any{"id": paymentID, "object": "payment_intent"})
	r := handle(storeWith(t, object, topUpGrant(0), Owner{Revision: 4}), &fakeStripe{})

	wantStep(t, r, webhookevent.Handled, "")
}

func TestStoreFailuresRetryWithoutEffects(t *testing.T) {
	cases := []struct {
		name  string
		store func(*fakeStore)
	}{
		{name: "payload read", store: func(f *fakeStore) { f.payloadErr = errors.New("database is locked") }},
		{name: "grant read", store: func(f *fakeStore) { f.grantErr = errors.New("database is locked") }},
		{name: "clawback record read", store: func(f *fakeStore) { f.recordedErr = errors.New("database is locked") }},
		{name: "owner read", store: func(f *fakeStore) { f.ownerErr = errors.New("database is locked") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			store := storeWith(t, refundedCharge(500, 1000), topUpGrant(0), Owner{Revision: 4})
			c.store(store)
			r := handle(store, &fakeStripe{})

			wantStep(t, r, webhookevent.Transient, "database is locked")
			wantNoEffects(t, r)
		})
	}
}
