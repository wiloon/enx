package stripe

import (
	"context"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// RetrieveSubscription fetches a subscription's current state from Stripe.
// Webhook handlers use it instead of the event payload because Stripe does
// not deliver events in order (and redelivers failed ones later), so a
// payload can be stale by the time it is processed.
func RetrieveSubscription(ctx context.Context, sc *stripeSDK.Client, subscriptionID string) (*stripeSDK.Subscription, error) {
	return sc.V1Subscriptions.Retrieve(ctx, subscriptionID, nil)
}
