// Package legacyprovenance decides the one-time legacy provenance backfill
// (ADR-067 §一次性充值与 Stripe Customer). A migrated GRANT_SUBSCRIPTION row
// carries no Subscription ID, invoice or period start, so an upgrade invoice
// could not find its denominator. For each migrated real subscription whose
// pool still comes from such a grant, the backfill reads the paid invoices
// Stripe links to that grant and pins the grant to the one invoice whose
// recurring line ends at credit_accounts.period_end. Pin is the pure rule;
// Backfill is the job that runs it over a Store and Stripe passed in, and
// writes only the provenance and its completion marker, never amounts,
// balances or ledger rows.
package legacyprovenance

import (
	"errors"
	"fmt"

	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
)

// Reasons the grant could not be pinned to one invoice.
const (
	ReasonNoMatchingInvoice = "no_matching_invoice"
	ReasonAmbiguousInvoices = "ambiguous_invoices"
)

// ErrLinesIncomplete: an invoice still has unread line pages. The backfill
// retries once the caller reads them; it never guesses from a partial list.
var ErrLinesIncomplete = errors.New("billing/legacyprovenance: invoice lines not fully read")

// Result is what the backfill records for the grant that supplies the pool.
type Result struct {
	Pinned    bool
	InvoiceID string
	Source    creditperiod.Source
	Reason    string
}

// Pin decides the provenance of the migrated grant behind subscriptionID's
// pool, whose credit_accounts.period_end is poolPeriodEnd. paid holds the
// paid invoices Stripe links to the grant: the ones its PaymentIntent paid,
// or for a zero-amount grant every paid invoice of the subscription.
//
// Only a non-proration line of subscriptionID ending at poolPeriodEnd counts:
// an upgrade invoice, another subscription's invoice or another period never
// pins the grant. With no such invoice, or more than one, nothing is guessed:
// the result is unpinned with a reason, and the caller records the grant
// without a period (creditperiod's legacy_grant_without_period).
func Pin(subscriptionID string, poolPeriodEnd int64, paid []invoice.Invoice) (Result, error) {
	var found []Result
	for _, inv := range paid {
		if !inv.LinesComplete {
			return Result{}, fmt.Errorf("%w: %s", ErrLinesIncomplete, inv.ID)
		}
		for _, l := range inv.Lines {
			if l.SubscriptionID == subscriptionID && !l.Proration && l.Period.End == poolPeriodEnd {
				found = append(found, Result{Pinned: true, InvoiceID: inv.ID, Source: creditperiod.Source{SubscriptionID: subscriptionID, Period: l.Period}})
			}
		}
	}
	switch len(found) {
	case 0:
		return Result{Reason: ReasonNoMatchingInvoice}, nil
	case 1:
		return found[0], nil
	default:
		return Result{Reason: ReasonAmbiguousInvoices}, nil
	}
}
