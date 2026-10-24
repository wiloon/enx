package checkoutcompleted

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/attribution"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
)

const (
	sessionID = "cs_test_1"
	customer  = "cus_1"
	subID     = "sub_1"
	created   = int64(1792829506)
)

var (
	scope        = webhookevent.Scope{AccountID: "acct_1", EventID: "evt_test"}
	topUpCredits = map[string]int64{"small": 300, "medium": 750, "large": 1500}
)

// session is the data.object of a dahlia checkout.session.completed event,
// shaped like the sessions ENX's Checkout creates.
type session map[string]any

func topUpSession() session {
	return session{
		"id": sessionID, "object": "checkout.session", "mode": "payment",
		"client_reference_id": "user_1", "customer": customer, "payment_intent": "pi_1",
		"subscription": nil, "metadata": map[string]string{"type": "topup", "tier": "small"},
	}
}

func subscriptionSession() session {
	return session{
		"id": sessionID, "object": "checkout.session", "mode": "subscription",
		"client_reference_id": "user_1", "customer": customer, "payment_intent": nil,
		"subscription": subID, "metadata": map[string]string{"type": "subscription", "plan": "pro"},
	}
}

func (s session) with(key string, value any) session {
	out := session{}
	for k, v := range s {
		out[k] = v
	}
	out[key] = value
	return out
}

func payload(t *testing.T, apiVersion string, object any) []byte {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"id": scope.EventID, "object": "event", "type": "checkout.session.completed",
		"api_version": apiVersion, "created": created, "livemode": false,
		"data": map[string]any{"object": object},
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type fakeStore struct {
	payload   []byte
	recorded  map[string]bool
	customers map[string]string
	subs      map[string]Subscription
	owners    map[string]Owner
	// payloadErr fails reading the payload; err fails every other read.
	payloadErr error
	err        error
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

func (f *fakeStore) TopUpRecorded(_ context.Context, id string) (bool, error) {
	return f.recorded[id], f.err
}

func (f *fakeStore) CustomerOwner(_ context.Context, id string) (string, error) {
	return f.customers[id], f.err
}

func (f *fakeStore) Subscription(_ context.Context, id string) (Subscription, error) {
	return f.subs[id], f.err
}

func (f *fakeStore) Owner(_ context.Context, userID string) (Owner, error) {
	return f.owners[userID], f.err
}

func storeWith(t *testing.T, object any) *fakeStore {
	t.Helper()
	return &fakeStore{
		payload: payload(t, "2026-08-26.dahlia", object),
		owners:  map[string]Owner{"user_1": {Revision: 3}},
	}
}

func handle(store *fakeStore) webhookevent.Result {
	return NewHandler(store, topUpCredits).Handle(context.Background(), webhookevent.StoredTask{
		Scope:      scope,
		APIVersion: "2026-08-26.dahlia",
		Task:       webhookevent.Task{Type: "checkout.session.completed"},
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
		t.Fatalf("effects = %#v, want checkoutcompleted.Effects", r.Effects)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("effects =\n%s\nwant\n%s", describe(got), describe(want))
	}
}

func describe(e Effects) string {
	b, _ := json.MarshalIndent(e, "", "  ")
	return string(b)
}

func TestTopUpGrantsItsTierCreditsAndRecordsTheCustomer(t *testing.T) {
	r := handle(storeWith(t, topUpSession()))

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed: Observed{UserID: "user_1", Revision: 3, CustomerID: customer},
		Customer: &CustomerOwnership{UserID: "user_1", CustomerID: customer},
		TopUp:    &TopUp{CheckoutSessionID: sessionID, PaymentIntentID: "pi_1", UserID: "user_1", Tier: "small", Credits: 300},
		FirstPayment: &referral.FirstPayment{
			Kind: referral.KindTopup, PaymentIntentID: "pi_1", Credits: 300, PaidAt: time.Unix(created, 0),
		},
	})
}

func TestTopUpWithoutACustomerOrACharge(t *testing.T) {
	// A payment-mode session without customer creation has no Customer to
	// record; a 100% discount charges nothing and is no referral payment.
	store := storeWith(t, topUpSession().with("customer", nil).with("payment_intent", nil))
	r := handle(store)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed: Observed{UserID: "user_1", Revision: 3},
		TopUp:    &TopUp{CheckoutSessionID: sessionID, UserID: "user_1", Tier: "small", Credits: 300},
	})
}

func TestTopUpOfACustomerTheUserAlreadyOwnsRecordsNoOwnership(t *testing.T) {
	store := storeWith(t, topUpSession())
	store.customers = map[string]string{customer: "user_1"}
	r := handle(store)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed:     Observed{UserID: "user_1", Revision: 3, CustomerID: customer, CustomerOwner: "user_1"},
		TopUp:        &TopUp{CheckoutSessionID: sessionID, PaymentIntentID: "pi_1", UserID: "user_1", Tier: "small", Credits: 300},
		FirstPayment: &referral.FirstPayment{Kind: referral.KindTopup, PaymentIntentID: "pi_1", Credits: 300, PaidAt: time.Unix(created, 0)},
	})
}

func TestATopUpAlreadyGrantedByAnotherEventChangesNothing(t *testing.T) {
	store := storeWith(t, topUpSession())
	store.recorded = map[string]bool{sessionID: true}
	r := handle(store)

	wantStep(t, r, webhookevent.Handled, "")
	if r.Effects != nil {
		t.Fatalf("effects = %#v, want none", r.Effects)
	}
}

func TestTopUpOfATierWithoutCreditsNeedsAttention(t *testing.T) {
	for name, metadata := range map[string]map[string]string{
		"unconfigured tier": {"type": "topup", "tier": "huge"},
		"no tier":           {"type": "topup"},
	} {
		t.Run(name, func(t *testing.T) {
			r := handle(storeWith(t, topUpSession().with("metadata", metadata)))

			wantStep(t, r, webhookevent.Unrecoverable, ReasonTopUpCreditsUnset)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

func TestSubscriptionCheckoutRecordsItsAssociationAndCustomerWithoutCredits(t *testing.T) {
	r := handle(storeWith(t, subscriptionSession()))

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed:    Observed{UserID: "user_1", Revision: 3, CustomerID: customer, SubscriptionID: subID},
		Customer:    &CustomerOwnership{UserID: "user_1", CustomerID: customer},
		Association: &CheckoutAssociation{CheckoutSessionID: sessionID, SubscriptionID: subID, UserID: "user_1", CustomerID: customer},
	})
}

func TestSubscriptionCheckoutAfterItsInvoiceAttributedTheSubscription(t *testing.T) {
	// The paid invoice arrived first and its metadata already attributed
	// the subscription to the same user: the association is still recorded.
	store := storeWith(t, subscriptionSession())
	store.customers = map[string]string{customer: "user_1"}
	store.subs = map[string]Subscription{subID: {Known: true, OwnerUserID: "user_1", Version: 4}}
	r := handle(store)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed: Observed{
			UserID: "user_1", Revision: 3, CustomerID: customer, CustomerOwner: "user_1",
			SubscriptionID: subID, SubscriptionKnown: true, SubscriptionVersion: 4,
		},
		Association: &CheckoutAssociation{CheckoutSessionID: sessionID, SubscriptionID: subID, UserID: "user_1", CustomerID: customer},
	})
}

func TestASubscriptionCheckoutAlreadyAssociatedChangesNothing(t *testing.T) {
	store := storeWith(t, subscriptionSession())
	store.customers = map[string]string{customer: "user_1"}
	store.subs = map[string]Subscription{subID: {Known: true, CheckoutUserID: "user_1", Version: 2}}
	r := handle(store)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{Observed: Observed{
		UserID: "user_1", Revision: 3, CustomerID: customer, CustomerOwner: "user_1",
		SubscriptionID: subID, SubscriptionKnown: true, SubscriptionVersion: 2,
	}})
}

func TestContradictoryUsersNeedAttentionAndChangeNothing(t *testing.T) {
	for name, sub := range map[string]Subscription{
		"another verified owner":       {Known: true, OwnerUserID: "user_2"},
		"another Checkout association": {Known: true, CheckoutUserID: "user_2"},
	} {
		t.Run(name, func(t *testing.T) {
			store := storeWith(t, subscriptionSession())
			store.subs = map[string]Subscription{subID: sub}
			r := handle(store)

			wantStep(t, r, webhookevent.Unrecoverable, attribution.ReasonContradictoryUserIdentity)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

func TestACustomerOwnedByAnotherUserNeedsAttentionAndGrantsNothing(t *testing.T) {
	for name, object := range map[string]session{
		"top-up":       topUpSession(),
		"subscription": subscriptionSession(),
	} {
		t.Run(name, func(t *testing.T) {
			store := storeWith(t, object)
			store.customers = map[string]string{customer: "user_2"}
			r := handle(store)

			wantStep(t, r, webhookevent.Unrecoverable, attribution.ReasonCustomerOwnedByAnotherUser)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

func TestDuringDeletionTheCheckoutWaitsWithoutEffects(t *testing.T) {
	for name, object := range map[string]session{
		"top-up":       topUpSession(),
		"subscription": subscriptionSession(),
	} {
		t.Run(name, func(t *testing.T) {
			store := storeWith(t, object)
			store.owners = map[string]Owner{"user_1": {Revision: 5, Deletion: acceptance.DeletionInProgress}}
			r := handle(store)

			wantStep(t, r, webhookevent.MissingDependency, ReasonDeletionInProgress)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

func TestAPaymentAfterDeletionNeedsAttentionKeepingOnlyItsOwnershipContext(t *testing.T) {
	deleted := map[string]Owner{"user_1": {Revision: 6, Deletion: acceptance.DeletionCompleted}}

	t.Run("top-up", func(t *testing.T) {
		store := storeWith(t, topUpSession())
		store.owners = deleted
		r := handle(store)

		wantStep(t, r, webhookevent.Unrecoverable, acceptance.ReasonPaymentAfterAccountDeletion)
		wantEffects(t, r, Effects{
			Observed: Observed{UserID: "user_1", Revision: 6, CustomerID: customer},
			Customer: &CustomerOwnership{UserID: "user_1", CustomerID: customer},
		})
	})
	t.Run("subscription", func(t *testing.T) {
		store := storeWith(t, subscriptionSession())
		store.owners = deleted
		r := handle(store)

		wantStep(t, r, webhookevent.Unrecoverable, acceptance.ReasonPaymentAfterAccountDeletion)
		wantEffects(t, r, Effects{
			Observed:    Observed{UserID: "user_1", Revision: 6, CustomerID: customer, SubscriptionID: subID},
			Customer:    &CustomerOwnership{UserID: "user_1", CustomerID: customer},
			Association: &CheckoutAssociation{CheckoutSessionID: sessionID, SubscriptionID: subID, UserID: "user_1", CustomerID: customer},
		})
	})
}

func TestUnreadableCheckoutsNeedAttention(t *testing.T) {
	for name, c := range map[string]struct {
		apiVersion string
		object     any
		reason     string
	}{
		"unsupported API version": {"2025-01-27.acacia", topUpSession(), webhookevent.ReasonUnsupportedAPIVersion},
		"not a Checkout Session":  {"2026-08-26.dahlia", topUpSession().with("object", "invoice"), ReasonMalformedCheckout},
		"no client_reference_id":  {"2026-08-26.dahlia", topUpSession().with("client_reference_id", nil), ReasonCheckoutWithoutUser},
		"subscription Checkout without a subscription": {
			"2026-08-26.dahlia", subscriptionSession().with("subscription", nil), ReasonMalformedCheckout,
		},
		"subscription Checkout without a Customer": {
			"2026-08-26.dahlia", subscriptionSession().with("customer", nil), ReasonMalformedCheckout,
		},
		"neither a top-up nor a subscription": {
			"2026-08-26.dahlia", topUpSession().with("metadata", map[string]string{}), ReasonUnrecognizedCheckout,
		},
	} {
		t.Run(name, func(t *testing.T) {
			store := storeWith(t, c.object)
			store.payload = payload(t, c.apiVersion, c.object)
			r := handle(store)

			wantStep(t, r, webhookevent.Unrecoverable, c.reason)
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}

func TestAnExpandedCustomerAndPaymentIntentAreRead(t *testing.T) {
	store := storeWith(t, topUpSession().
		with("customer", map[string]string{"id": customer, "object": "customer"}).
		with("payment_intent", map[string]string{"id": "pi_1", "object": "payment_intent"}))
	r := handle(store)

	wantStep(t, r, webhookevent.Handled, "")
	wantEffects(t, r, Effects{
		Observed:     Observed{UserID: "user_1", Revision: 3, CustomerID: customer},
		Customer:     &CustomerOwnership{UserID: "user_1", CustomerID: customer},
		TopUp:        &TopUp{CheckoutSessionID: sessionID, PaymentIntentID: "pi_1", UserID: "user_1", Tier: "small", Credits: 300},
		FirstPayment: &referral.FirstPayment{Kind: referral.KindTopup, PaymentIntentID: "pi_1", Credits: 300, PaidAt: time.Unix(created, 0)},
	})
}

func TestStoreFailuresRetryWithoutEffects(t *testing.T) {
	failure := errors.New("database is locked")
	for name, c := range map[string]struct {
		object          session
		payloadErr, err error
	}{
		"reading the payload":           {topUpSession(), failure, nil},
		"reading a top-up's records":    {topUpSession(), nil, failure},
		"reading a subscription's rows": {subscriptionSession(), nil, failure},
	} {
		t.Run(name, func(t *testing.T) {
			store := storeWith(t, c.object)
			store.payloadErr, store.err = c.payloadErr, c.err
			r := handle(store)

			wantStep(t, r, webhookevent.Transient, "database is locked")
			if r.Effects != nil {
				t.Fatalf("effects = %#v, want none", r.Effects)
			}
		})
	}
}
