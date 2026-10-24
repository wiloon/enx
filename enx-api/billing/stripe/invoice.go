package stripe

import (
	"context"
	"fmt"

	"enx-api/billing/invoice"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// InvoicePaymentIntent returns the payment intent that paid invoiceID, or ""
// when no paid payment carries one. The invoice.paid payload no longer
// includes it, so it comes from /v1/invoice_payments (checked against real
// sandbox events for ADR-049, 2026-10-16).
func InvoicePaymentIntent(ctx context.Context, sc *stripeSDK.Client, invoiceID string) (string, error) {
	list := sc.V1InvoicePayments.List(ctx, &stripeSDK.InvoicePaymentListParams{
		Invoice: stripeSDK.String(invoiceID),
		Status:  stripeSDK.String("paid"),
	})
	for payment, err := range list.All(ctx) {
		if err != nil {
			return "", fmt.Errorf("billing/stripe: list payments of invoice %s: %w", invoiceID, err)
		}
		if payment.Payment != nil && payment.Payment.PaymentIntent != nil && payment.Payment.PaymentIntent.ID != "" {
			return payment.Payment.PaymentIntent.ID, nil
		}
	}
	return "", nil
}

// PaidInvoicesOfPaymentIntent returns the invoices paymentIntentID paid,
// each with every line page read: the reverse of InvoicePaymentIntent, for
// the legacy provenance backfill (ADR-067). These are API responses in the
// SDK's pinned version, not stored webhook payloads, so the SDK schema reads
// them.
func PaidInvoicesOfPaymentIntent(ctx context.Context, sc *stripeSDK.Client, paymentIntentID string) ([]invoice.Invoice, error) {
	params := &stripeSDK.InvoicePaymentListParams{
		Payment: &stripeSDK.InvoicePaymentListPaymentParams{
			Type:          stripeSDK.String("payment_intent"),
			PaymentIntent: stripeSDK.String(paymentIntentID),
		},
		Status: stripeSDK.String("paid"),
	}
	params.AddExpand("data.invoice")
	var paid []invoice.Invoice
	for payment, err := range sc.V1InvoicePayments.List(ctx, params).All(ctx) {
		if err != nil {
			return nil, fmt.Errorf("billing/stripe: list invoice payments of %s: %w", paymentIntentID, err)
		}
		if payment.Invoice == nil {
			continue
		}
		inv, err := withLines(ctx, sc, payment.Invoice)
		if err != nil {
			return nil, err
		}
		paid = append(paid, inv)
	}
	return paid, nil
}

// PaidInvoicesOfSubscription returns every paid invoice of subscriptionID,
// each with every line page read: the legacy provenance backfill's lookup for
// a zero-amount grant, which has no PaymentIntent.
func PaidInvoicesOfSubscription(ctx context.Context, sc *stripeSDK.Client, subscriptionID string) ([]invoice.Invoice, error) {
	list := sc.V1Invoices.List(ctx, &stripeSDK.InvoiceListParams{
		Subscription: stripeSDK.String(subscriptionID),
		Status:       stripeSDK.String("paid"),
	})
	var paid []invoice.Invoice
	for src, err := range list.All(ctx) {
		if err != nil {
			return nil, fmt.Errorf("billing/stripe: list paid invoices of %s: %w", subscriptionID, err)
		}
		inv, err := withLines(ctx, sc, src)
		if err != nil {
			return nil, err
		}
		paid = append(paid, inv)
	}
	return paid, nil
}

// withLines normalizes src, reading its lines from /v1/invoices/{id}/lines
// so no page is left unread.
func withLines(ctx context.Context, sc *stripeSDK.Client, src *stripeSDK.Invoice) (invoice.Invoice, error) {
	inv := invoice.Invoice{ID: src.ID, BillingReason: string(src.BillingReason), LinesComplete: true}
	if src.Parent != nil && src.Parent.SubscriptionDetails != nil && src.Parent.SubscriptionDetails.Subscription != nil {
		inv.SubscriptionID = src.Parent.SubscriptionDetails.Subscription.ID
	}
	for l, err := range sc.V1Invoices.ListLines(ctx, &stripeSDK.InvoiceListLinesParams{Invoice: stripeSDK.String(src.ID)}).All(ctx) {
		if err != nil {
			return invoice.Invoice{}, fmt.Errorf("billing/stripe: list lines of invoice %s: %w", src.ID, err)
		}
		line := invoice.Line{ID: l.ID, Amount: l.Amount}
		if l.Period != nil {
			line.Period = invoice.Period{Start: l.Period.Start, End: l.Period.End}
		}
		if l.Parent != nil && l.Parent.SubscriptionItemDetails != nil {
			d := l.Parent.SubscriptionItemDetails
			line.SubscriptionID, line.SubscriptionItemID, line.Proration = d.Subscription, d.SubscriptionItem, d.Proration
		}
		if l.Pricing != nil && l.Pricing.PriceDetails != nil && l.Pricing.PriceDetails.Price != nil {
			line.PriceID = l.Pricing.PriceDetails.Price.ID
		}
		inv.Lines = append(inv.Lines, line)
	}
	return inv, nil
}
