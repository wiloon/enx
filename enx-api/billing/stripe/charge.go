package stripe

import (
	"context"
	"fmt"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// PaymentRefundedOrDisputed reports whether any charge of paymentIntentID
// was refunded, even in part, or disputed. Stripe is asked every time: a
// dispute has no local record (ADR-049 Decision 10), so for ADR-051's reward
// check Stripe is the one authority for both.
func PaymentRefundedOrDisputed(ctx context.Context, sc *stripeSDK.Client, paymentIntentID string) (refunded, disputed bool, err error) {
	list := sc.V1Charges.List(ctx, &stripeSDK.ChargeListParams{
		PaymentIntent: stripeSDK.String(paymentIntentID),
	})
	for charge, err := range list.All(ctx) {
		if err != nil {
			return false, false, fmt.Errorf("billing/stripe: list charges of payment intent %s: %w", paymentIntentID, err)
		}
		refunded = refunded || charge.AmountRefunded > 0
		disputed = disputed || charge.Disputed
	}
	return refunded, disputed, nil
}
