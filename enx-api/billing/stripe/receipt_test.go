package stripe

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"enx-api/billing/webhookevent"

	"github.com/stripe/stripe-go/v86/webhook"
)

const receiptSecret = "whsec_receipt_secret"

func signedAt(payload []byte, secret string, at time.Time) (body []byte, header string) {
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
		Payload:   payload,
		Secret:    secret,
		Timestamp: at,
	})
	return signed.Payload, signed.Header
}

// An event of an API version other than the SDK's is still a genuine Stripe
// delivery: receipt stores it and the worker decides what it supports.
func TestVerifyWebhookAcceptsASignedEventOfAnotherAPIVersion(t *testing.T) {
	payload := []byte(`{"id":"evt_1","object":"event","type":"invoice.paid","created":1792829506,"livemode":false,` +
		`"api_version":"2024-06-20","data":{"object":{"object":"invoice","id":"in_1"}}}`)
	body, header := signedAt(payload, receiptSecret, time.Now())

	if err := VerifyWebhook(body, header, receiptSecret); err != nil {
		t.Errorf("VerifyWebhook of a signed event of another API version: %v, want nil", err)
	}
}

func TestEndpointAccountIDReadsTheAccountOfTheAPIKey(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/account" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"acct_sandbox","object":"account"}`))
	})

	got, err := EndpointAccountID(context.Background(), sc)

	if err != nil {
		t.Fatalf("EndpointAccountID: %v", err)
	}
	if got != "acct_sandbox" {
		t.Errorf("EndpointAccountID = %q, want acct_sandbox", got)
	}
}

func TestEndpointAccountIDFailsWithoutAnAccount(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"an API error": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"Invalid API Key provided"}}`))
		},
		"an account with no ID": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"object":"account"}`))
		},
	}
	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := EndpointAccountID(context.Background(), newTestClient(t, handler))
			if err == nil {
				t.Errorf("EndpointAccountID = %q with no error, want an error", got)
			}
		})
	}
}

func TestVerifyWebhookRefusesARequestStripeDidNotSign(t *testing.T) {
	payload := []byte(`{"id":"evt_1","object":"event","type":"invoice.paid","created":1792829506,"livemode":false,` +
		`"api_version":"2026-08-26.dahlia","data":{"object":{"object":"invoice","id":"in_1"}}}`)
	cases := []struct {
		name   string
		header func() (body []byte, header string)
	}{
		{"another secret", func() ([]byte, string) { return signedAt(payload, "whsec_other", time.Now()) }},
		{"no signature header", func() ([]byte, string) { return payload, "" }},
		{"a timestamp outside the tolerance", func() ([]byte, string) {
			return signedAt(payload, receiptSecret, time.Now().Add(-time.Hour))
		}},
		{"a changed body", func() ([]byte, string) {
			_, header := signedAt(payload, receiptSecret, time.Now())
			return append(append([]byte(nil), payload...), ' '), header
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body, header := c.header()
			err := VerifyWebhook(body, header, receiptSecret)
			if !errors.Is(err, webhookevent.ErrBadSignature) {
				t.Errorf("VerifyWebhook = %v, want ErrBadSignature", err)
			}
		})
	}
}

func TestVerifyWebhookRefusesASignedPayloadThatIsNotAnEvent(t *testing.T) {
	for name, payload := range map[string]string{
		"not JSON":      `not json`,
		"not an event":  `{"id":"in_1","object":"invoice"}`,
		"a JSON string": `"evt_1"`,
	} {
		t.Run(name, func(t *testing.T) {
			body, header := signedAt([]byte(payload), receiptSecret, time.Now())
			err := VerifyWebhook(body, header, receiptSecret)
			if !errors.Is(err, webhookevent.ErrMalformedEnvelope) {
				t.Errorf("VerifyWebhook = %v, want ErrMalformedEnvelope", err)
			}
		})
	}
}
