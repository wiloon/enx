package adapters

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/referral"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// newStripe points a Stripe adapter at a local server answering with handler.
func newStripe(t *testing.T, handler http.HandlerFunc) Stripe {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL:        stripeSDK.String(server.URL),
		HTTPClient: server.Client(),
	})
	return Stripe{Client: stripeSDK.NewClient("sk_test_123", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))}
}

func TestStripeFindsTheInvoicesPaymentIntent(t *testing.T) {
	s := newStripe(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/invoice_payments" || r.URL.Query().Get("invoice") != "in_1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoice_payments","has_more":false,"data":[` +
			`{"id":"inpay_1","object":"invoice_payment","status":"paid","payment":{"type":"payment_intent","payment_intent":"pi_1"}}]}`))
	})

	pi, err := s.InvoicePaymentIntent(context.Background(), "in_1")
	if err != nil || pi != "pi_1" {
		t.Fatalf("InvoicePaymentIntent = %q, %v; want pi_1", pi, err)
	}
}

func TestStripeReportsRefundsAndDisputesSeparately(t *testing.T) {
	for name, tc := range map[string]struct {
		charge string
		want   referral.ChargeState
	}{
		"refunded": {`{"id":"ch_1","object":"charge","amount_refunded":399,"disputed":false}`, referral.ChargeState{Refunded: true}},
		"disputed": {`{"id":"ch_1","object":"charge","amount_refunded":0,"disputed":true}`, referral.ChargeState{Disputed: true}},
	} {
		t.Run(name, func(t *testing.T) {
			s := newStripe(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/charges" || r.URL.Query().Get("payment_intent") != "pi_1" {
					http.NotFound(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"object":"list","url":"/v1/charges","has_more":false,"data":[` + tc.charge + `]}`))
			})

			got, err := s.Charge(context.Background(), "pi_1")
			if err != nil || got != tc.want {
				t.Fatalf("Charge = %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}
