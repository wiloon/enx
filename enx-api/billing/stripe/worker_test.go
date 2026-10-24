package stripe

import (
	"context"
	"net/http"
	"testing"

	"enx-api/billing/chargerefunded"
	"enx-api/billing/invoicepaid"
	"enx-api/billing/snapshot"
)

var (
	_ invoicepaid.Stripe    = (*WorkerClient)(nil)
	_ snapshot.Stripe       = (*WorkerClient)(nil)
	_ chargerefunded.Stripe = (*WorkerClient)(nil)
)

func TestTheWorkerClientReadsASubscriptionsLiveStatus(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/subscriptions/sub_1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sub_1","object":"subscription","status":"past_due"}`))
	})

	got, err := NewWorkerClient(sc).SubscriptionStatus(context.Background(), "sub_1")

	if err != nil {
		t.Fatalf("SubscriptionStatus: %v", err)
	}
	if got != "past_due" {
		t.Errorf("SubscriptionStatus = %q, want past_due", got)
	}
}

// A missing subscription never proves it ended (ADR-067), so its status is
// an error, not "canceled".
func TestTheWorkerClientReturnsAMissingSubscriptionsStatusAsAnError(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription: 'sub_1'"}}`))
	})

	got, err := NewWorkerClient(sc).SubscriptionStatus(context.Background(), "sub_1")

	if err == nil {
		t.Errorf("SubscriptionStatus of a missing subscription = %q with no error, want an error", got)
	}
}

func TestTheWorkerClientReadsSnapshotsAndInvoicePaymentsAndCancels(t *testing.T) {
	var cancelled string
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/subscriptions/sub_1":
			_, _ = w.Write([]byte(subscriptionObject("false")))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/invoice_payments":
			if r.URL.Query().Get("invoice") != "in_1" {
				t.Errorf("invoice payments listed for %q, want in_1", r.URL.Query().Get("invoice"))
			}
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoice_payments","has_more":false,"data":[` +
				`{"id":"inpay_1","object":"invoice_payment","status":"paid","payment":{"type":"payment_intent","payment_intent":"pi_1"}}]}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/subscriptions/sub_2":
			cancelled = "sub_2"
			_, _ = w.Write([]byte(`{"id":"sub_2","object":"subscription","status":"canceled"}`))
		default:
			http.NotFound(w, r)
		}
	})
	client := NewWorkerClient(sc)
	ctx := context.Background()

	live, err := client.Subscription(ctx, "sub_1")
	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	if live.Status != "active" || len(live.PriceIDs) != 1 || live.PriceIDs[0] != "price_max" || !live.ItemsComplete {
		t.Errorf("Subscription = %+v, want active with the one Price price_max", live)
	}

	pi, err := client.InvoicePaymentIntent(ctx, "in_1")
	if err != nil {
		t.Fatalf("InvoicePaymentIntent: %v", err)
	}
	if pi != "pi_1" {
		t.Errorf("InvoicePaymentIntent = %q, want pi_1", pi)
	}

	if err := client.CancelSubscriptionNow(ctx, "sub_2"); err != nil {
		t.Fatalf("CancelSubscriptionNow: %v", err)
	}
	if cancelled != "sub_2" {
		t.Errorf("cancelled %q, want sub_2", cancelled)
	}
}
