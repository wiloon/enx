package webhookdispatch

import (
	"context"

	"enx-api/billing/invoicepaid"
	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
)

// InvoiceSnapshot commits the invoice and the live subscription snapshot together.
type InvoiceSnapshot struct {
	Invoice  invoicepaid.Effects
	Snapshot snapshot.Effects
}

type invoiceWithSnapshot struct{ invoice, snapshot KindHandler }

// WithInvoiceSnapshot refreshes the live subscription before committing an invoice.
func WithInvoiceSnapshot(invoice, snapshot KindHandler) KindHandler {
	return invoiceWithSnapshot{invoice: invoice, snapshot: snapshot}
}

func (h invoiceWithSnapshot) Handle(ctx context.Context, task webhookevent.StoredTask) webhookevent.Result {
	result := h.invoice.Handle(ctx, task)
	effects, ok := result.Effects.(invoicepaid.Effects)
	if !ok || result.Step != webhookevent.Handled {
		return result
	}
	current := h.snapshot.Handle(ctx, task)
	if current.Step != webhookevent.Handled {
		return current
	}
	s, ok := current.Effects.(snapshot.Effects)
	if !ok || s.Known != effects.Observed.SubscriptionKnown || s.Version != effects.Observed.SubscriptionVersion {
		return webhookevent.Result{Step: webhookevent.Transient, Reason: "subscription changed during invoice assessment"}
	}
	result.Effects = InvoiceSnapshot{Invoice: effects, Snapshot: s}
	return result
}
