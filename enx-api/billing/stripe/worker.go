package stripe

import (
	"context"
	"fmt"

	"enx-api/billing/snapshot"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// WorkerClient is Stripe as the webhook event decision services see it: it
// serves invoicepaid.Stripe, snapshot.Stripe and chargerefunded.Stripe.
type WorkerClient struct {
	sc *stripeSDK.Client
}

// NewWorkerClient returns a WorkerClient over sc.
func NewWorkerClient(sc *stripeSDK.Client) *WorkerClient {
	return &WorkerClient{sc: sc}
}

// SubscriptionStatus is the subscription's live Stripe status. Any error,
// resource_missing included, is returned: it never proves the subscription
// ended.
func (c *WorkerClient) SubscriptionStatus(ctx context.Context, subscriptionID string) (string, error) {
	sub, err := RetrieveSubscription(ctx, c.sc, subscriptionID)
	if err != nil {
		return "", fmt.Errorf("billing/stripe: retrieve subscription %s: %w", subscriptionID, err)
	}
	return string(sub.Status), nil
}

// Subscription is the subscription's live state, as SubscriptionSnapshot
// reads it.
func (c *WorkerClient) Subscription(ctx context.Context, subscriptionID string) (snapshot.Live, error) {
	return SubscriptionSnapshot(ctx, c.sc, subscriptionID)
}

// InvoicePaymentIntent is the PaymentIntent that paid the invoice, "" when
// none did.
func (c *WorkerClient) InvoicePaymentIntent(ctx context.Context, invoiceID string) (string, error) {
	return InvoicePaymentIntent(ctx, c.sc, invoiceID)
}

// CancelSubscriptionNow ends the subscription at once, as the package-level
// CancelSubscriptionNow does.
func (c *WorkerClient) CancelSubscriptionNow(ctx context.Context, subscriptionID string) error {
	return CancelSubscriptionNow(ctx, c.sc, subscriptionID)
}
