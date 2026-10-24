// Package webhookdispatch routes each durably received Stripe webhook event
// to the decision service of its kind (ADR-067): it is the
// webhookevent.Handler the worker calls.
package webhookdispatch

import (
	"context"
	"fmt"

	"enx-api/billing/webhookevent"
)

// ReasonNoHandler: the worker asked for a kind no decision service handles.
const ReasonNoHandler = "no_handler_for_kind"

// KindHandler decides events of one kind: checkoutcompleted, invoicepaid,
// chargerefunded and snapshot each provide one.
type KindHandler interface {
	Handle(ctx context.Context, s webhookevent.StoredTask) webhookevent.Result
}

// Handlers are the decision services, one per business event kind.
type Handlers struct {
	Checkout    KindHandler
	InvoicePaid KindHandler
	Refund      KindHandler
	Snapshot    KindHandler
}

// Dispatcher routes an event to the handler of its kind.
type Dispatcher struct {
	byKind map[webhookevent.Kind]KindHandler
}

// New returns a dispatcher over every handler. A missing handler is a
// configuration error, so the worker never starts without one.
func New(h Handlers) (*Dispatcher, error) {
	byKind := map[webhookevent.Kind]KindHandler{
		webhookevent.KindCheckout:    h.Checkout,
		webhookevent.KindInvoicePaid: h.InvoicePaid,
		webhookevent.KindRefund:      h.Refund,
		webhookevent.KindSnapshot:    h.Snapshot,
	}
	for kind, handler := range byKind {
		if handler == nil {
			return nil, fmt.Errorf("billing/webhookdispatch: no handler for kind %q", kind)
		}
	}
	return &Dispatcher{byKind: byKind}, nil
}

// Handle decides one event with the handler of kind and returns its result
// unchanged. The worker resolves ignored and escalated events itself, so any
// other kind reaching here needs attention rather than a silent retry.
func (d *Dispatcher) Handle(ctx context.Context, kind webhookevent.Kind, s webhookevent.StoredTask) webhookevent.Result {
	handler, ok := d.byKind[kind]
	if !ok {
		return webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: ReasonNoHandler}
	}
	return handler.Handle(ctx, s)
}
