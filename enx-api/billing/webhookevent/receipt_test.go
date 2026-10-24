package webhookevent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

var sandbox = Endpoint{AccountID: "acct_sandbox", Livemode: false}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "testdata", "stripe-plan-change", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestReceiveReadsTheEnvelopeOfARealEvent(t *testing.T) {
	r, err := Receive(sandbox, fixture(t, "02-invoice.paid-subscription_create.json"))
	if err != nil {
		t.Fatalf("Receive: %v", err)
	}
	want := Envelope{
		EventID:    "evt_1UU03KD98PEpzR2EukKUVHWx",
		Type:       "invoice.paid",
		Created:    1792829506,
		APIVersion: "2026-07-29.dahlia",
		Livemode:   false,
	}
	if r.Envelope.EventID != want.EventID || r.Envelope.Type != want.Type || r.Envelope.Created != want.Created ||
		r.Envelope.APIVersion != want.APIVersion || r.Envelope.Livemode != want.Livemode || r.Envelope.Account != "" {
		t.Errorf("Envelope = %+v, want %+v", r.Envelope, want)
	}
	if got, want := r.Scope, (Scope{AccountID: "acct_sandbox", Livemode: false, EventID: "evt_1UU03KD98PEpzR2EukKUVHWx"}); got != want {
		t.Errorf("Scope = %+v, want %+v", got, want)
	}
}

func TestReceiveKeepsTheReferencesOfTheBusinessObject(t *testing.T) {
	const sub, cus = "sub_1UU03ID98PEpzR2EJ2kjpqD1", "cus_VV03wKkovxzzTP"
	cases := []struct {
		name    string
		payload []byte
		want    References
	}{
		{
			"a subscription invoice",
			fixture(t, "02-invoice.paid-subscription_create.json"),
			References{SubscriptionID: sub, CustomerID: cus, InvoiceID: "in_1UU03ID98PEpzR2EMP53Agf8"},
		},
		{
			"a subscription event",
			fixture(t, "04-customer.subscription.updated-active.json"),
			References{SubscriptionID: sub, CustomerID: cus},
		},
		{
			"a subscription schedule event",
			fixture(t, "08-subscription_schedule.created-active.json"),
			References{SubscriptionID: sub, CustomerID: cus},
		},
		{
			"a subscription checkout",
			[]byte(`{"id":"evt_cs","object":"event","type":"checkout.session.completed","created":1,"api_version":"2026-08-26.dahlia","livemode":false,
				"data":{"object":{"object":"checkout.session","id":"cs_1","customer":"cus_1","subscription":"sub_1","payment_intent":null,"client_reference_id":"user-1"}}}`),
			References{CheckoutSessionID: "cs_1", SubscriptionID: "sub_1", CustomerID: "cus_1"},
		},
		{
			"a top-up checkout with expanded objects",
			[]byte(`{"id":"evt_cs","object":"event","type":"checkout.session.completed","created":1,"api_version":"2026-08-26.dahlia","livemode":false,
				"data":{"object":{"object":"checkout.session","id":"cs_2","customer":{"id":"cus_2","object":"customer"},"subscription":null,"payment_intent":{"id":"pi_2","object":"payment_intent"}}}}`),
			References{CheckoutSessionID: "cs_2", CustomerID: "cus_2", PaymentIntentID: "pi_2"},
		},
		{
			"a refunded charge",
			[]byte(`{"id":"evt_ch","object":"event","type":"charge.refunded","created":1,"api_version":"2026-08-26.dahlia","livemode":false,
				"data":{"object":{"object":"charge","id":"ch_1","customer":"cus_1","payment_intent":"pi_1"}}}`),
			References{ChargeID: "ch_1", CustomerID: "cus_1", PaymentIntentID: "pi_1"},
		},
		{
			"a one-off invoice has no subscription",
			[]byte(`{"id":"evt_in","object":"event","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","livemode":false,
				"data":{"object":{"object":"invoice","id":"in_9","customer":"cus_9","parent":null}}}`),
			References{InvoiceID: "in_9", CustomerID: "cus_9"},
		},
		{
			"an unsupported API version is received without guessing its references",
			[]byte(`{"id":"evt_old","object":"event","type":"invoice.paid","created":1,"api_version":"2020-08-27","livemode":false,
				"data":{"object":{"object":"invoice","id":"in_old","customer":"cus_old","subscription":"sub_old"}}}`),
			References{},
		},
		{
			"a missing API version is received without guessing its references",
			[]byte(`{"id":"evt_nov","object":"event","type":"invoice.paid","created":1,"livemode":false,
				"data":{"object":{"object":"invoice","id":"in_x","customer":"cus_x"}}}`),
			References{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, err := Receive(sandbox, tc.payload)
			if err != nil {
				t.Fatalf("Receive: %v", err)
			}
			if r.Refs != tc.want {
				t.Errorf("Refs = %+v, want %+v", r.Refs, tc.want)
			}
		})
	}
}

func TestReceiveRefusesAMalformedEnvelope(t *testing.T) {
	cases := map[string]string{
		"not JSON":            `{"id":`,
		"not an object":       `["evt_1"]`,
		"no Event ID":         `{"object":"event","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":{"object":"invoice","id":"in_1"}}}`,
		"not an event":        `{"id":"evt_1","object":"invoice","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":{"object":"invoice","id":"in_1"}}}`,
		"no type":             `{"id":"evt_1","object":"event","created":1,"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":{"object":"invoice","id":"in_1"}}}`,
		"no creation time":    `{"id":"evt_1","object":"event","type":"invoice.paid","api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":{"object":"invoice","id":"in_1"}}}`,
		"no livemode":         `{"id":"evt_1","object":"event","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","data":{"object":{"object":"invoice","id":"in_1"}}}`,
		"no data object":      `{"id":"evt_1","object":"event","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","livemode":false,"data":{}}`,
		"a data object array": `{"id":"evt_1","object":"event","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":[1]}}`,
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Receive(sandbox, []byte(payload)); !errors.Is(err, ErrMalformedEnvelope) {
				t.Errorf("Receive = %v, want ErrMalformedEnvelope", err)
			}
		})
	}
}

func TestReceiptOutcome(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want Outcome
	}{
		{"durably received", nil, Outcome{Reason: "received", Accepted: true}},
		{"bad signature", fmt.Errorf("verify: %w", ErrBadSignature), Outcome{Reason: "bad_signature"}},
		{"malformed envelope", fmt.Errorf("x: %w", ErrMalformedEnvelope), Outcome{Reason: "malformed_envelope"}},
		{"wrong account", fmt.Errorf("%w: acct_other", ErrWrongAccount), Outcome{Reason: "wrong_account"}},
		{"wrong mode", ErrWrongMode, Outcome{Reason: "wrong_mode"}},
		{"account not discovered yet", ErrEndpointUnknown, Outcome{Reason: "endpoint_unknown", Retryable: true}},
		{"storage failure", errors.New("database is locked"), Outcome{Reason: "storage_failed", Retryable: true}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ReceiptOutcome(tc.err); got != tc.want {
				t.Errorf("ReceiptOutcome(%v) = %+v, want %+v", tc.err, got, tc.want)
			}
		})
	}
}

func TestReceiveRefusesAnEventForAnotherEndpoint(t *testing.T) {
	payload := fixture(t, "02-invoice.paid-subscription_create.json")
	cases := []struct {
		name     string
		endpoint Endpoint
		want     error
	}{
		{"before account discovery", Endpoint{}, ErrEndpointUnknown},
		{"the other mode", Endpoint{AccountID: "acct_sandbox", Livemode: true}, ErrWrongMode},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Receive(tc.endpoint, payload); !errors.Is(err, tc.want) {
				t.Errorf("Receive = %v, want %v", err, tc.want)
			}
		})
	}
	t.Run("another explicit account", func(t *testing.T) {
		other := []byte(`{"id":"evt_1","object":"event","type":"invoice.paid","created":1,"api_version":"2026-08-26.dahlia","account":"acct_other","livemode":false,"data":{"object":{"object":"invoice","id":"in_1"}}}`)
		if _, err := Receive(sandbox, other); !errors.Is(err, ErrWrongAccount) {
			t.Errorf("Receive = %v, want ErrWrongAccount", err)
		}
	})
}
