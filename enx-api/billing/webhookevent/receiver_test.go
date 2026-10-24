package webhookevent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

const goodSignature = "t=1,v1=good"

// fakeReceiptStore keeps what Record committed, as one transaction would:
// every delivery, and a task per scoped event that a later delivery of the
// same event never replaces.
type fakeReceiptStore struct {
	deliveries []Delivery
	tasks      map[Scope]Task
	err        error
}

func newFakeReceiptStore() *fakeReceiptStore {
	return &fakeReceiptStore{tasks: map[Scope]Task{}}
}

func (s *fakeReceiptStore) Record(_ context.Context, d Delivery, task Task) error {
	if s.err != nil {
		return s.err
	}
	s.deliveries = append(s.deliveries, d)
	if _, ok := s.tasks[d.Receipt.Scope]; !ok {
		s.tasks[d.Receipt.Scope] = task
	}
	return nil
}

func verifyGood(_ []byte, sigHeader string) error {
	if sigHeader != goodSignature {
		return fmt.Errorf("%w: no valid signature", ErrBadSignature)
	}
	return nil
}

type receiverFixture struct {
	store    *fakeReceiptStore
	endpoint Endpoint
	now      time.Time
	ids      int
}

func newReceiverFixture() *receiverFixture {
	return &receiverFixture{
		store:    newFakeReceiptStore(),
		endpoint: sandbox,
		now:      time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC),
	}
}

func (f *receiverFixture) receiver() *Receiver {
	return NewReceiver(verifyGood,
		func() Endpoint { return f.endpoint },
		f.store,
		func() time.Time { return f.now },
		func() string { f.ids++; return fmt.Sprintf("dlv_%d", f.ids) })
}

func TestAVerifiedDeliveryIsStoredWithItsRawPayloadAndAPendingTask(t *testing.T) {
	f := newReceiverFixture()
	payload := fixture(t, "02-invoice.paid-subscription_create.json")

	got := f.receiver().Receive(context.Background(), payload, goodSignature)

	if want := (Outcome{Reason: "received", Accepted: true}); got != want {
		t.Errorf("Receive = %+v, want %+v", got, want)
	}
	if len(f.store.deliveries) != 1 {
		t.Fatalf("recorded %d deliveries, want 1", len(f.store.deliveries))
	}
	d := f.store.deliveries[0]
	scope := Scope{AccountID: "acct_sandbox", Livemode: false, EventID: "evt_1UU03KD98PEpzR2EukKUVHWx"}
	if d.ID != "dlv_1" || !d.ReceivedAt.Equal(f.now) || !bytes.Equal(d.Payload, payload) {
		t.Errorf("delivery = {ID:%s ReceivedAt:%s, payload of %d bytes}, want {ID:dlv_1 ReceivedAt:%s, the raw payload}",
			d.ID, d.ReceivedAt, len(d.Payload), f.now)
	}
	if d.Receipt.Scope != scope || d.Receipt.Envelope.Type != "invoice.paid" ||
		d.Receipt.Envelope.APIVersion != "2026-07-29.dahlia" || d.Receipt.Envelope.Created != 1792829506 {
		t.Errorf("delivery receipt = %+v, want the invoice.paid envelope scoped to %+v", d.Receipt, scope)
	}
	if d.Receipt.Refs.SubscriptionID != "sub_1UU03ID98PEpzR2EJ2kjpqD1" || d.Receipt.Refs.InvoiceID != "in_1UU03ID98PEpzR2EMP53Agf8" {
		t.Errorf("delivery references = %+v, want the invoice's subscription and ID", d.Receipt.Refs)
	}
	want := Task{Type: "invoice.paid", SubscriptionID: "sub_1UU03ID98PEpzR2EJ2kjpqD1", Status: Pending, NextAttemptAt: f.now}
	if task := f.store.tasks[scope]; task != want {
		t.Errorf("task = %+v, want %+v", task, want)
	}
}

// A lost 2xx makes Stripe deliver the same event again: every delivery is
// kept as its own receipt of the one scoped event.
func TestARepeatedDeliveryIsStoredAsAnotherReceiptOfTheSameEvent(t *testing.T) {
	f := newReceiverFixture()
	r := f.receiver()
	payload := fixture(t, "04-customer.subscription.updated-active.json")

	first := r.Receive(context.Background(), payload, goodSignature)
	f.now = f.now.Add(time.Minute)
	second := r.Receive(context.Background(), payload, goodSignature)

	if !first.Accepted || !second.Accepted {
		t.Fatalf("Receive = %+v then %+v, want both accepted", first, second)
	}
	if len(f.store.deliveries) != 2 {
		t.Fatalf("recorded %d deliveries, want 2", len(f.store.deliveries))
	}
	a, b := f.store.deliveries[0], f.store.deliveries[1]
	if a.ID == b.ID {
		t.Errorf("both deliveries have ID %s, want distinct delivery IDs", a.ID)
	}
	if a.Receipt.Scope != b.Receipt.Scope {
		t.Errorf("deliveries scoped to %+v and %+v, want the same event", a.Receipt.Scope, b.Receipt.Scope)
	}
	if !b.ReceivedAt.Equal(f.now) {
		t.Errorf("second delivery received at %s, want its own receipt time %s", b.ReceivedAt, f.now)
	}
}

// An event of an API version the worker cannot read is still a genuine
// delivery: it is stored, and the worker escalates it with an alert.
func TestADeliveryOfAnUnsupportedAPIVersionIsStored(t *testing.T) {
	f := newReceiverFixture()
	payload := []byte(`{"id":"evt_old","object":"event","type":"invoice.paid","created":1792829506,"livemode":false,` +
		`"api_version":"2024-06-20","data":{"object":{"object":"invoice","id":"in_1","subscription":"sub_1"}}}`)

	got := f.receiver().Receive(context.Background(), payload, goodSignature)

	if !got.Accepted {
		t.Fatalf("Receive = %+v, want accepted", got)
	}
	if len(f.store.deliveries) != 1 || f.store.deliveries[0].Receipt.Envelope.APIVersion != "2024-06-20" {
		t.Fatalf("deliveries = %+v, want the 2024-06-20 delivery", f.store.deliveries)
	}
	if task := f.store.tasks[sandbox.Scope("evt_old")]; task.Status != Pending || task.Type != "invoice.paid" {
		t.Errorf("task = %+v, want a pending invoice.paid task", task)
	}
}

func TestARefusedDeliveryStoresNothing(t *testing.T) {
	event := func(account string, livemode bool) []byte {
		acct := ""
		if account != "" {
			acct = `"account":"` + account + `",`
		}
		return []byte(fmt.Sprintf(`{"id":"evt_1","object":"event","type":"invoice.paid","created":1792829506,%s"livemode":%t,`+
			`"api_version":"2026-08-26.dahlia","data":{"object":{"object":"invoice","id":"in_1"}}}`, acct, livemode))
	}
	cases := []struct {
		name      string
		payload   []byte
		signature string
		endpoint  Endpoint
		want      Outcome
	}{
		{"a bad signature", event("", false), "t=1,v1=forged", sandbox, Outcome{Reason: "bad_signature"}},
		{"a malformed envelope", []byte(`{"object":"event","id":"evt_1"}`), goodSignature, sandbox, Outcome{Reason: "malformed_envelope"}},
		{"another account", event("acct_other", false), goodSignature, sandbox, Outcome{Reason: "wrong_account"}},
		{"the other mode", event("", true), goodSignature, sandbox, Outcome{Reason: "wrong_mode"}},
		{"an endpoint not discovered yet", event("", false), goodSignature, Endpoint{}, Outcome{Reason: "endpoint_unknown", Retryable: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newReceiverFixture()
			f.endpoint = c.endpoint

			got := f.receiver().Receive(context.Background(), c.payload, c.signature)

			if got != c.want {
				t.Errorf("Receive = %+v, want %+v", got, c.want)
			}
			if len(f.store.deliveries) != 0 || len(f.store.tasks) != 0 {
				t.Errorf("stored %d deliveries and %d tasks, want none", len(f.store.deliveries), len(f.store.tasks))
			}
		})
	}
}

// The signature is checked before anything else, so a forged request never
// learns whether the endpoint is ready.
func TestABadSignatureIsRefusedBeforeTheEndpointIsChecked(t *testing.T) {
	f := newReceiverFixture()
	f.endpoint = Endpoint{}

	got := f.receiver().Receive(context.Background(), fixture(t, "02-invoice.paid-subscription_create.json"), "t=1,v1=forged")

	if want := (Outcome{Reason: "bad_signature"}); got != want {
		t.Errorf("Receive = %+v, want %+v", got, want)
	}
}

func TestAStorageFailureAsksStripeToDeliverAgain(t *testing.T) {
	f := newReceiverFixture()
	f.store.err = errors.New("database is locked")

	got := f.receiver().Receive(context.Background(), fixture(t, "02-invoice.paid-subscription_create.json"), goodSignature)

	if want := (Outcome{Reason: "storage_failed", Retryable: true}); got != want {
		t.Errorf("Receive = %+v, want %+v", got, want)
	}
}
