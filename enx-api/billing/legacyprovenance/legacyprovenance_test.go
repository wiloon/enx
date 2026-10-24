package legacyprovenance

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
)

// Sandbox IDs and periods in billing/testdata/stripe-plan-change.
const (
	sandboxSub    = "sub_1UU03ID98PEpzR2EJ2kjpqD1"
	createInvoice = "in_1UU03ID98PEpzR2EMP53Agf8"
	firstEnd      = int64(1795507901)
)

func loadFixture(t *testing.T, name string) invoice.Invoice {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join("..", "testdata", "stripe-plan-change", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	inv, err := invoice.DecodeEvent(payload)
	if err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	return inv
}

func TestPinRecordsThePeriodOfTheInvoiceThePaymentIntentPaid(t *testing.T) {
	got, err := Pin(sandboxSub, firstEnd, []invoice.Invoice{loadFixture(t, "02-invoice.paid-subscription_create.json")})
	if err != nil {
		t.Fatalf("Pin: %v", err)
	}
	want := Result{
		Pinned:    true,
		InvoiceID: createInvoice,
		Source:    creditperiod.Source{SubscriptionID: sandboxSub, Period: invoice.Period{Start: 1792829501, End: firstEnd}},
	}
	if got != want {
		t.Errorf("Pin = %+v, want %+v", got, want)
	}
}

// A zero-amount grant has no PaymentIntent: the backfill reads every paid
// invoice of the subscription, upgrades and later renewals included.
func TestPinPicksThePaidInvoiceOfThePoolPeriodAmongTheSubscriptionsInvoices(t *testing.T) {
	all := []invoice.Invoice{
		loadFixture(t, "02-invoice.paid-subscription_create.json"),
		loadFixture(t, "03-invoice.paid-subscription_update.json"),
		loadFixture(t, "05-invoice.paid-subscription_update.json"),
		loadFixture(t, "15-invoice.paid-subscription_cycle.json"),
	}
	cases := []struct {
		name    string
		poolEnd int64
		want    Result
	}{
		{"pool from the first period", firstEnd, Result{
			Pinned: true, InvoiceID: createInvoice,
			Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: invoice.Period{Start: 1792829501, End: firstEnd}},
		}},
		{"pool from the renewal", 1798099901, Result{
			Pinned: true, InvoiceID: "in_1UU05WD98PEpzR2EOXJkis8z",
			Source: creditperiod.Source{SubscriptionID: sandboxSub, Period: invoice.Period{Start: firstEnd, End: 1798099901}},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Pin(sandboxSub, tc.poolEnd, all)
			if err != nil {
				t.Fatalf("Pin: %v", err)
			}
			if got != tc.want {
				t.Errorf("Pin = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// A line page left unread could hold the pool period's line, so the backfill
// fails and retries rather than recording the grant without a period.
func TestPinRefusesAnInvoiceWithUnreadLinePages(t *testing.T) {
	partial := loadFixture(t, "15-invoice.paid-subscription_cycle.json")
	partial.LinesComplete = false
	_, err := Pin(sandboxSub, firstEnd, []invoice.Invoice{partial})
	if !errors.Is(err, ErrLinesIncomplete) {
		t.Errorf("Pin error = %v, want ErrLinesIncomplete", err)
	}
}

func recurring(invoiceID, subscriptionID string, period invoice.Period) invoice.Invoice {
	return invoice.Invoice{
		ID: invoiceID, BillingReason: "subscription_cycle", SubscriptionID: subscriptionID, LinesComplete: true,
		Lines: []invoice.Line{{ID: "il_" + invoiceID, SubscriptionID: subscriptionID, SubscriptionItemID: "si_1", PriceID: "price_pro", Amount: 399, Period: period}},
	}
}

// Stripe cannot pin the grant to one invoice: nothing is guessed, the grant
// is recorded without a period and its period's upgrade needs attention.
func TestPinRecordsAGrantWithoutPeriodWhenStripeCannotPinOneInvoice(t *testing.T) {
	period := invoice.Period{Start: firstEnd - 2678400, End: firstEnd}
	cases := []struct {
		name string
		paid []invoice.Invoice
		want string
	}{
		{"no paid invoice", nil, ReasonNoMatchingInvoice},
		{"the grant paid an upgrade invoice", []invoice.Invoice{loadFixture(t, "03-invoice.paid-subscription_update.json")}, ReasonNoMatchingInvoice},
		{"the recurring line ends elsewhere", []invoice.Invoice{loadFixture(t, "15-invoice.paid-subscription_cycle.json")}, ReasonNoMatchingInvoice},
		{"an invoice of another subscription", []invoice.Invoice{recurring("in_other", "sub_other", period)}, ReasonNoMatchingInvoice},
		{"two invoices of the pool period", []invoice.Invoice{recurring("in_a", sandboxSub, period), recurring("in_b", sandboxSub, period)}, ReasonAmbiguousInvoices},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Pin(sandboxSub, firstEnd, tc.paid)
			if err != nil {
				t.Fatalf("Pin: %v", err)
			}
			if want := (Result{Reason: tc.want}); got != want {
				t.Errorf("Pin = %+v, want %+v", got, want)
			}
		})
	}
}
