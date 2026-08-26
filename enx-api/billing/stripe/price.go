package stripe

import (
	"context"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// PlanTiers lists the subscription tiers, in the order checked by
// SubscriptionTierForPrice. Also used by handler.go's request validation
// (checkoutSubscriptionRequest.Plan) so the two stay in sync.
var PlanTiers = []string{"pro", "pro-plus", "max"}

// SubscriptionTierForPrice compares priceID (typically read off an invoice
// line item) against the configured stripe.price.{pro,pro-plus,max}
// lookup_keys and reports which tier it matches, or "" if it matches none.
// Used by the invoice.paid webhook handler to pick the right
// stripe.credits.subscription-* amount without needing the checkout session
// that originally created the subscription (which the invoice event doesn't
// carry, and Stripe doesn't guarantee event ordering for anyway).
func SubscriptionTierForPrice(ctx context.Context, sc *stripeSDK.Client, priceID string, tierLookupKeys map[string]string) (string, error) {
	for _, tier := range PlanTiers {
		lookupKey := tierLookupKeys[tier]
		if lookupKey == "" {
			continue
		}
		price, err := PriceForLookupKey(ctx, sc, lookupKey)
		if err != nil {
			return "", err
		}
		if price.ID == priceID {
			return tier, nil
		}
	}
	return "", nil
}
