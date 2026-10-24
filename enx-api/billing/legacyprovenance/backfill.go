package legacyprovenance

import (
	"context"
	"errors"
	"fmt"

	"enx-api/billing/invoice"
)

// Grant is a migrated GRANT_SUBSCRIPTION ledger row that supplies a
// migrated real subscription's pool and has no provenance recorded yet.
type Grant struct {
	// TransactionID is the credit_transactions row.
	TransactionID  string
	SubscriptionID string
	// PoolPeriodEnd is the owner's credit_accounts.period_end.
	PoolPeriodEnd int64
	// PaymentIntentID is "" for a zero-amount grant.
	PaymentIntentID string
}

// Store reads the grants still to backfill and records the outcome.
type Store interface {
	// Unrecorded returns every grant that supplies a migrated pool and has
	// no provenance recorded yet.
	Unrecorded(ctx context.Context) ([]Grant, error)
	// Record writes grant's provenance: the pinned invoice and period, or a
	// grant without a period with r.Reason. It changes no amount, balance
	// or ledger row.
	Record(ctx context.Context, grant Grant, r Result) error
	// MarkDone records that the backfill finished, the marker
	// webhookevent.TaskStore.LegacyBackfillDone reads. Marking twice is a
	// no-op.
	MarkDone(ctx context.Context) error
}

// Stripe reads the paid invoices linked to a grant, every line page read.
type Stripe interface {
	PaidInvoicesOfPaymentIntent(ctx context.Context, paymentIntentID string) ([]invoice.Invoice, error)
	PaidInvoicesOfSubscription(ctx context.Context, subscriptionID string) ([]invoice.Invoice, error)
}

// Report counts what one run recorded.
type Report struct {
	Pinned        int
	WithoutPeriod int
}

// Backfill is the one-time legacy provenance backfill job.
type Backfill struct {
	store  Store
	stripe Stripe
}

// NewBackfill returns a backfill over store and stripe.
func NewBackfill(store Store, stripe Stripe) *Backfill {
	return &Backfill{store: store, stripe: stripe}
}

// Run records the provenance of every unrecorded grant, then marks the
// backfill done. A grant whose Stripe read or record fails stays
// unrecorded and is never recorded without a period; the others are still
// recorded, the marker is not written, and the joined errors are returned.
// Running again retries only what is left, so Run is safe to repeat.
func (b *Backfill) Run(ctx context.Context) (Report, error) {
	var report Report
	grants, err := b.store.Unrecorded(ctx)
	if err != nil {
		return report, err
	}
	var errs []error
	for _, g := range grants {
		r, err := b.backfill(ctx, g)
		if err != nil {
			errs = append(errs, fmt.Errorf("billing/legacyprovenance: grant %s: %w", g.TransactionID, err))
			continue
		}
		if r.Pinned {
			report.Pinned++
		} else {
			report.WithoutPeriod++
		}
	}
	if len(errs) > 0 {
		return report, errors.Join(errs...)
	}
	return report, b.store.MarkDone(ctx)
}

// backfill pins g from Stripe and records the result.
func (b *Backfill) backfill(ctx context.Context, g Grant) (Result, error) {
	paid, err := b.paidInvoices(ctx, g)
	if err != nil {
		return Result{}, err
	}
	r, err := Pin(g.SubscriptionID, g.PoolPeriodEnd, paid)
	if err != nil {
		return Result{}, err
	}
	return r, b.store.Record(ctx, g, r)
}

// paidInvoices are the paid invoices Stripe links to g: the ones its
// PaymentIntent paid, or for a zero-amount grant every paid invoice of its
// subscription.
func (b *Backfill) paidInvoices(ctx context.Context, g Grant) ([]invoice.Invoice, error) {
	if g.PaymentIntentID == "" {
		return b.stripe.PaidInvoicesOfSubscription(ctx, g.SubscriptionID)
	}
	return b.stripe.PaidInvoicesOfPaymentIntent(ctx, g.PaymentIntentID)
}
