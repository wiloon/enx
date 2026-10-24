package webhookevent

import (
	"context"
	"time"
)

// Delivery is one verified HTTP delivery of a Stripe event, kept with its
// complete original payload. Repeated deliveries of one event are separate
// deliveries of the same scoped event.
type Delivery struct {
	ID         string
	ReceivedAt time.Time
	Receipt    Receipt
	Payload    []byte
}

// ReceiptStore keeps received deliveries and their event tasks.
type ReceiptStore interface {
	// Record appends the delivery and, in the same transaction, stores
	// task as the task of the delivery's scoped event unless that event
	// already has one, which it leaves unchanged. Receipt answers Stripe
	// only after Record commits.
	Record(ctx context.Context, d Delivery, task Task) error
}

// Receiver durably receives Stripe webhook deliveries (ADR-067): it checks
// the signature, admits the event to the endpoint, and commits the delivery
// with its event task before answering Stripe. Business processing happens
// later, in the worker.
type Receiver struct {
	verify   func(payload []byte, sigHeader string) error
	endpoint func() Endpoint
	store    ReceiptStore
	now      func() time.Time
	newID    func() string
}

// NewReceiver returns a receiver. verify checks the Stripe-Signature header
// and returns ErrBadSignature or ErrMalformedEnvelope on refusal; endpoint
// returns the endpoint as discovered so far; newID returns a fresh, unique
// delivery ID on every call.
func NewReceiver(verify func(payload []byte, sigHeader string) error, endpoint func() Endpoint, store ReceiptStore, now func() time.Time, newID func() string) *Receiver {
	return &Receiver{verify: verify, endpoint: endpoint, store: store, now: now, newID: newID}
}

// Receive handles one webhook request and returns what to answer Stripe.
// Nothing is stored unless the delivery is accepted.
func (r *Receiver) Receive(ctx context.Context, payload []byte, sigHeader string) Outcome {
	return ReceiptOutcome(r.receive(ctx, payload, sigHeader))
}

func (r *Receiver) receive(ctx context.Context, payload []byte, sigHeader string) error {
	if err := r.verify(payload, sigHeader); err != nil {
		return err
	}
	receipt, err := Receive(r.endpoint(), payload)
	if err != nil {
		return err
	}
	now := r.now()
	d := Delivery{ID: r.newID(), ReceivedAt: now, Receipt: receipt, Payload: payload}
	return r.store.Record(ctx, d, NewTask(receipt.Envelope.Type, receipt.Refs.SubscriptionID, now))
}
