package stripe

import (
	"context"
	"net/http"
	"testing"
)

func chargeList(charges ...string) string {
	data := ""
	for i, c := range charges {
		if i > 0 {
			data += ","
		}
		data += c
	}
	return `{"object":"list","url":"/v1/charges","has_more":false,"data":[` + data + `]}`
}

func TestPaymentRefundedOrDisputed(t *testing.T) {
	cases := []struct {
		name                    string
		body                    string
		wantRefund, wantDispute bool
	}{
		{"clean", chargeList(`{"id":"ch_1","object":"charge","amount_refunded":0,"disputed":false}`), false, false},
		{"partly refunded", chargeList(`{"id":"ch_1","object":"charge","amount_refunded":50,"disputed":false}`), true, false},
		{"disputed", chargeList(`{"id":"ch_1","object":"charge","amount_refunded":0,"disputed":true}`), false, true},
		{"a failed attempt then a refunded charge", chargeList(
			`{"id":"ch_1","object":"charge","amount_refunded":0,"disputed":false}`,
			`{"id":"ch_2","object":"charge","amount_refunded":399,"disputed":false}`), true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var gotPI string
			sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/charges" {
					http.NotFound(w, r)
					return
				}
				gotPI = r.URL.Query().Get("payment_intent")
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(c.body))
			})

			refunded, disputed, err := PaymentRefundedOrDisputed(context.Background(), sc, "pi_1")
			if err != nil {
				t.Fatalf("PaymentRefundedOrDisputed: %v", err)
			}
			if gotPI != "pi_1" {
				t.Errorf("listed charges of %q, want pi_1", gotPI)
			}
			if refunded != c.wantRefund || disputed != c.wantDispute {
				t.Errorf("refunded=%v disputed=%v, want %v/%v", refunded, disputed, c.wantRefund, c.wantDispute)
			}
		})
	}
}

func TestPaymentRefundedOrDisputedReportsAStripeError(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"boom"}}`))
	})
	if _, _, err := PaymentRefundedOrDisputed(context.Background(), sc, "pi_1"); err == nil {
		t.Fatal("PaymentRefundedOrDisputed succeeded on a Stripe error")
	}
}
