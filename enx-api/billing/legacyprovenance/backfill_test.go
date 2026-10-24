package legacyprovenance

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
)

type recorded struct {
	Grant  Grant
	Result Result
}

type fakeStore struct {
	grants    []Grant
	listErr   error
	recordErr map[string]error
	recorded  []recorded
	markErr   error
	doneMarks int
}

func (s *fakeStore) Unrecorded(context.Context) ([]Grant, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	var out []Grant
	for _, g := range s.grants {
		if !s.has(g.TransactionID) {
			out = append(out, g)
		}
	}
	return out, nil
}

func (s *fakeStore) Record(_ context.Context, g Grant, r Result) error {
	if err := s.recordErr[g.TransactionID]; err != nil {
		return err
	}
	s.recorded = append(s.recorded, recorded{g, r})
	return nil
}

func (s *fakeStore) MarkDone(context.Context) error {
	if s.markErr != nil {
		return s.markErr
	}
	s.doneMarks++
	return nil
}

func (s *fakeStore) has(id string) bool {
	for _, r := range s.recorded {
		if r.Grant.TransactionID == id {
			return true
		}
	}
	return false
}

type fakeStripe struct {
	byPaymentIntent   map[string][]invoice.Invoice
	bySubscription    map[string][]invoice.Invoice
	err               map[string]error
	paymentIntents    []string
	subscriptionsRead []string
}

func (f *fakeStripe) PaidInvoicesOfPaymentIntent(_ context.Context, id string) ([]invoice.Invoice, error) {
	f.paymentIntents = append(f.paymentIntents, id)
	return f.byPaymentIntent[id], f.err[id]
}

func (f *fakeStripe) PaidInvoicesOfSubscription(_ context.Context, id string) ([]invoice.Invoice, error) {
	f.subscriptionsRead = append(f.subscriptionsRead, id)
	return f.bySubscription[id], f.err[id]
}

func pinnedCreate() Result {
	return Result{
		Pinned:    true,
		InvoiceID: createInvoice,
		Source:    creditperiod.Source{SubscriptionID: sandboxSub, Period: invoice.Period{Start: 1792829501, End: firstEnd}},
	}
}

func TestBackfillPinsAGrantToTheInvoiceItsPaymentIntentPaid(t *testing.T) {
	grant := Grant{TransactionID: "tx_1", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd, PaymentIntentID: "pi_1"}
	store := &fakeStore{grants: []Grant{grant}}
	stripe := &fakeStripe{byPaymentIntent: map[string][]invoice.Invoice{
		"pi_1": {loadFixture(t, "02-invoice.paid-subscription_create.json")},
	}}

	report, err := NewBackfill(store, stripe).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	want := []recorded{{grant, pinnedCreate()}}
	if !reflect.DeepEqual(store.recorded, want) {
		t.Errorf("recorded %+v, want %+v", store.recorded, want)
	}
	if report != (Report{Pinned: 1}) {
		t.Errorf("report = %+v, want one pinned grant", report)
	}
	if len(stripe.subscriptionsRead) != 0 {
		t.Errorf("read the subscription's invoices %v for a grant with a PaymentIntent", stripe.subscriptionsRead)
	}
}

func TestBackfillPinsAZeroAmountGrantAmongTheSubscriptionsPaidInvoices(t *testing.T) {
	grant := Grant{TransactionID: "tx_1", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd}
	store := &fakeStore{grants: []Grant{grant}}
	stripe := &fakeStripe{bySubscription: map[string][]invoice.Invoice{
		sandboxSub: {
			loadFixture(t, "02-invoice.paid-subscription_create.json"),
			loadFixture(t, "03-invoice.paid-subscription_update.json"),
			loadFixture(t, "15-invoice.paid-subscription_cycle.json"),
		},
	}}

	if _, err := NewBackfill(store, stripe).Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}

	want := []recorded{{grant, pinnedCreate()}}
	if !reflect.DeepEqual(store.recorded, want) {
		t.Errorf("recorded %+v, want %+v", store.recorded, want)
	}
	if len(stripe.paymentIntents) != 0 {
		t.Errorf("read PaymentIntent invoices %q for a zero-amount grant", stripe.paymentIntents)
	}
}

// Stripe cannot pin either grant to one invoice, so each is recorded
// without a period and its period's upgrade invoice will need attention.
func TestBackfillRecordsAGrantStripeCannotPinWithoutAPeriod(t *testing.T) {
	noMatch := Grant{TransactionID: "tx_1", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd + 1, PaymentIntentID: "pi_1"}
	ambiguous := Grant{TransactionID: "tx_2", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd, PaymentIntentID: "pi_2"}
	create := loadFixture(t, "02-invoice.paid-subscription_create.json")
	twin := create
	twin.ID = "in_twin"
	store := &fakeStore{grants: []Grant{noMatch, ambiguous}}
	stripe := &fakeStripe{byPaymentIntent: map[string][]invoice.Invoice{
		"pi_1": {create},
		"pi_2": {create, twin},
	}}

	report, err := NewBackfill(store, stripe).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	want := []recorded{
		{noMatch, Result{Reason: ReasonNoMatchingInvoice}},
		{ambiguous, Result{Reason: ReasonAmbiguousInvoices}},
	}
	if !reflect.DeepEqual(store.recorded, want) {
		t.Errorf("recorded %+v, want %+v", store.recorded, want)
	}
	if report != (Report{WithoutPeriod: 2}) {
		t.Errorf("report = %+v, want two grants without a period", report)
	}
}

// The marker opens the worker's gate on subscription invoices, so it is
// written only once every grant is recorded, also when there is none.
func TestBackfillMarksItselfDoneOnceEveryGrantIsRecorded(t *testing.T) {
	create := loadFixture(t, "02-invoice.paid-subscription_create.json")
	cases := []struct {
		name   string
		grants []Grant
	}{
		{"no migrated grant", nil},
		{"every grant recorded", []Grant{
			{TransactionID: "tx_1", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd, PaymentIntentID: "pi_1"},
			{TransactionID: "tx_2", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd + 1, PaymentIntentID: "pi_1"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{grants: tc.grants}
			stripe := &fakeStripe{byPaymentIntent: map[string][]invoice.Invoice{"pi_1": {create}}}

			if _, err := NewBackfill(store, stripe).Run(context.Background()); err != nil {
				t.Fatalf("Run: %v", err)
			}

			if store.doneMarks != 1 {
				t.Errorf("marked done %d times, want once", store.doneMarks)
			}
		})
	}
}

// A failed read or write is retried, never recorded as a grant without a
// period: the failing grant stays unrecorded and the gate stays shut, while
// the other grants are recorded. A second run finishes the job.
func TestBackfillRetriesAGrantItCouldNotRecordAndStaysUnfinished(t *testing.T) {
	create := loadFixture(t, "02-invoice.paid-subscription_create.json")
	partial := create
	partial.LinesComplete = false
	failing := Grant{TransactionID: "tx_1", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd, PaymentIntentID: "pi_fail"}
	healthy := Grant{TransactionID: "tx_2", SubscriptionID: sandboxSub, PoolPeriodEnd: firstEnd, PaymentIntentID: "pi_ok"}
	stripeDown := errors.New("stripe down")
	dbDown := errors.New("db down")
	cases := []struct {
		name string
		fail func(*fakeStore, *fakeStripe)
		heal func(*fakeStore, *fakeStripe)
		want error
	}{
		{"a Stripe read fails",
			func(_ *fakeStore, f *fakeStripe) { f.err = map[string]error{"pi_fail": stripeDown} },
			func(_ *fakeStore, f *fakeStripe) { f.err = nil },
			stripeDown},
		{"an invoice has unread line pages",
			func(_ *fakeStore, f *fakeStripe) { f.byPaymentIntent["pi_fail"] = []invoice.Invoice{partial} },
			func(_ *fakeStore, f *fakeStripe) { f.byPaymentIntent["pi_fail"] = []invoice.Invoice{create} },
			ErrLinesIncomplete},
		{"recording fails",
			func(s *fakeStore, _ *fakeStripe) { s.recordErr = map[string]error{"tx_1": dbDown} },
			func(s *fakeStore, _ *fakeStripe) { s.recordErr = nil },
			dbDown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{grants: []Grant{failing, healthy}}
			stripe := &fakeStripe{byPaymentIntent: map[string][]invoice.Invoice{"pi_fail": {create}, "pi_ok": {create}}}
			tc.fail(store, stripe)
			backfill := NewBackfill(store, stripe)

			_, err := backfill.Run(context.Background())

			if !errors.Is(err, tc.want) {
				t.Errorf("Run error = %v, want %v", err, tc.want)
			}
			if want := []recorded{{healthy, pinnedCreate()}}; !reflect.DeepEqual(store.recorded, want) {
				t.Errorf("recorded %+v, want only the healthy grant %+v", store.recorded, want)
			}
			if store.doneMarks != 0 {
				t.Errorf("marked done %d times with a grant unrecorded, want never", store.doneMarks)
			}

			tc.heal(store, stripe)
			report, err := backfill.Run(context.Background())

			if err != nil {
				t.Fatalf("second Run: %v", err)
			}
			if report != (Report{Pinned: 1}) || !store.has("tx_1") || store.doneMarks != 1 {
				t.Errorf("second run report = %+v, tx_1 recorded = %v, done marks = %d; want tx_1 pinned and done once",
					report, store.has("tx_1"), store.doneMarks)
			}
		})
	}
}

func TestBackfillFailsWhenItCannotListTheGrants(t *testing.T) {
	dbDown := errors.New("db down")
	store := &fakeStore{listErr: dbDown}

	_, err := NewBackfill(store, &fakeStripe{}).Run(context.Background())

	if !errors.Is(err, dbDown) || store.doneMarks != 0 {
		t.Errorf("Run error = %v, done marks = %d; want the list error and no marker", err, store.doneMarks)
	}
}

func TestBackfillReportsAFailedCompletionMarker(t *testing.T) {
	dbDown := errors.New("db down")
	store := &fakeStore{markErr: dbDown}

	_, err := NewBackfill(store, &fakeStripe{}).Run(context.Background())

	if !errors.Is(err, dbDown) {
		t.Errorf("Run error = %v, want the marker's error", err)
	}
}
