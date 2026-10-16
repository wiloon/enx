package stripe

import (
	"context"
	"fmt"

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
