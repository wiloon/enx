package webhookdispatch

import (
	"context"
	"testing"

	"enx-api/billing/invoicepaid"
	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
)

type fixedResult webhookevent.Result

func (r fixedResult) Handle(context.Context, webhookevent.StoredTask) webhookevent.Result {
	return webhookevent.Result(r)
}

func TestInvoiceSnapshotWaitsForStripeFailureWithoutCommittingInvoice(t *testing.T) {
	invoice := fixedResult{Step: webhookevent.Handled, Effects: invoicepaid.Effects{}}
	refresh := fixedResult{Step: webhookevent.Transient, Reason: "Stripe unavailable"}
	got := WithInvoiceSnapshot(invoice, refresh).Handle(context.Background(), webhookevent.StoredTask{})
	if got.Step != webhookevent.Transient || got.Effects != nil {
		t.Fatalf("result = %+v, want retry without invoice effects", got)
	}
}

func TestInvoiceSnapshotRetriesWhenSubscriptionChangedDuringAssessment(t *testing.T) {
	invoice := fixedResult{Step: webhookevent.Handled, Effects: invoicepaid.Effects{Observed: invoicepaid.Observed{SubscriptionKnown: true, SubscriptionVersion: 1}}}
	refresh := fixedResult{Step: webhookevent.Handled, Effects: snapshot.Effects{Known: true, Version: 2}}
	got := WithInvoiceSnapshot(invoice, refresh).Handle(context.Background(), webhookevent.StoredTask{})
	if got.Step != webhookevent.Transient || got.Effects != nil {
		t.Fatalf("result = %+v, want retry without stale effects", got)
	}
}
