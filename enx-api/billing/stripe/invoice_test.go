package stripe

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"enx-api/billing/invoice"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

const invoiceObject = `{"id":"in_1","object":"invoice","billing_reason":"subscription_cycle","status":"paid",` +
	`"parent":{"type":"subscription_details","subscription_details":{"subscription":"sub_1"}}}`

func lineObject(id string, proration bool, amount, start, end string) string {
	p := "false"
	if proration {
		p = "true"
	}
	return `{"id":"` + id + `","object":"line_item","amount":` + amount + `,` +
		`"parent":{"type":"subscription_item_details","subscription_item_details":{"proration":` + p + `,"subscription":"sub_1","subscription_item":"si_1"}},` +
		`"period":{"start":` + start + `,"end":` + end + `},` +
		`"pricing":{"type":"price_details","price_details":{"price":"price_pro","product":"prod_pro"}}}`
}

// serveInvoiceLines answers /v1/invoices/in_1/lines in two pages, so the
// adapter must follow has_more.
func serveInvoiceLines(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Query().Get("starting_after") == "" {
		_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoices/in_1/lines","has_more":true,"data":[` +
			lineObject("il_1", true, "-270", "100", "200") + `]}`))
		return
	}
	if got := r.URL.Query().Get("starting_after"); got != "il_1" {
		t.Errorf("second line page starts after %q, want il_1", got)
	}
	_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoices/in_1/lines","has_more":false,"data":[` +
		lineObject("il_2", false, "399", "200", "300") + `]}`))
}

var wantInvoice = invoice.Invoice{
	ID: "in_1", BillingReason: "subscription_cycle", SubscriptionID: "sub_1", LinesComplete: true,
	Lines: []invoice.Line{
		{ID: "il_1", SubscriptionID: "sub_1", SubscriptionItemID: "si_1", PriceID: "price_pro", Proration: true, Amount: -270, Period: invoice.Period{Start: 100, End: 200}},
		{ID: "il_2", SubscriptionID: "sub_1", SubscriptionItemID: "si_1", PriceID: "price_pro", Amount: 399, Period: invoice.Period{Start: 200, End: 300}},
	},
}

func TestPaidInvoicesOfPaymentIntentReadsEveryLineOfTheInvoicesItPaid(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/invoice_payments":
			q := r.URL.Query()
			if q.Get("payment[type]") != "payment_intent" || q.Get("payment[payment_intent]") != "pi_1" || q.Get("status") != "paid" {
				t.Errorf("invoice payments listed with %v, want the paid payments of payment intent pi_1", q)
			}
			if q.Get("expand[0]") != "data.invoice" {
				t.Errorf("invoice payments listed with expand %q, want data.invoice", q.Get("expand[0]"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoice_payments","has_more":false,"data":[` +
				`{"id":"inpay_1","object":"invoice_payment","status":"paid","invoice":` + invoiceObject + `,` +
				`"payment":{"type":"payment_intent","payment_intent":"pi_1"}}]}`))
		case "/v1/invoices/in_1/lines":
			serveInvoiceLines(t, w, r)
		default:
			http.NotFound(w, r)
		}
	})

	got, err := PaidInvoicesOfPaymentIntent(context.Background(), sc, "pi_1")
	if err != nil {
		t.Fatalf("PaidInvoicesOfPaymentIntent: %v", err)
	}
	if want := []invoice.Invoice{wantInvoice}; !reflect.DeepEqual(got, want) {
		t.Errorf("PaidInvoicesOfPaymentIntent = %+v, want %+v", got, want)
	}
}

func TestPaidInvoicesOfSubscriptionReadsEveryLineOfItsPaidInvoices(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/invoices":
			q := r.URL.Query()
			if q.Get("subscription") != "sub_1" || q.Get("status") != "paid" {
				t.Errorf("invoices listed with %v, want the paid invoices of sub_1", q)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoices","has_more":false,"data":[` + invoiceObject + `]}`))
		case "/v1/invoices/in_1/lines":
			serveInvoiceLines(t, w, r)
		default:
			http.NotFound(w, r)
		}
	})

	got, err := PaidInvoicesOfSubscription(context.Background(), sc, "sub_1")
	if err != nil {
		t.Fatalf("PaidInvoicesOfSubscription: %v", err)
	}
	if want := []invoice.Invoice{wantInvoice}; !reflect.DeepEqual(got, want) {
		t.Errorf("PaidInvoicesOfSubscription = %+v, want %+v", got, want)
	}
}

// A failed Stripe read is an error the backfill retries, never an empty list
// that would record the grant without a period.
func TestPaidInvoicesReportAStripeError(t *testing.T) {
	cases := []struct {
		name    string
		failing string
		read    func(*stripeSDK.Client) error
	}{
		{"invoice payments", "/v1/invoice_payments", func(sc *stripeSDK.Client) error {
			_, err := PaidInvoicesOfPaymentIntent(context.Background(), sc, "pi_1")
			return err
		}},
		{"invoices of a subscription", "/v1/invoices", func(sc *stripeSDK.Client) error {
			_, err := PaidInvoicesOfSubscription(context.Background(), sc, "sub_1")
			return err
		}},
		{"lines of an invoice", "/v1/invoices/in_1/lines", func(sc *stripeSDK.Client) error {
			_, err := PaidInvoicesOfSubscription(context.Background(), sc, "sub_1")
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == tc.failing {
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
					return
				}
				switch r.URL.Path {
				case "/v1/invoices":
					_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoices","has_more":false,"data":[` + invoiceObject + `]}`))
				case "/v1/invoice_payments":
					_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoice_payments","has_more":false,"data":[]}`))
				default:
					http.NotFound(w, r)
				}
			})
			if err := tc.read(sc); err == nil {
				t.Fatal("read succeeded on a Stripe error")
			}
		})
	}
}
