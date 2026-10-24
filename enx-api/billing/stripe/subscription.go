package stripe

import (
	"context"
	"errors"
	"fmt"

	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// RetrieveSubscription fetches a subscription's current state from Stripe.
// Webhook handlers use it instead of the event payload because Stripe does
// not deliver events in order (and redelivers failed ones later), so a
// payload can be stale by the time it is processed.
func RetrieveSubscription(ctx context.Context, sc *stripeSDK.Client, subscriptionID string) (*stripeSDK.Subscription, error) {
	return sc.V1Subscriptions.Retrieve(ctx, subscriptionID, nil)
}

// SubscriptionSnapshot reads the live state a subscription snapshot records
// (ADR-067): status, scheduled cancellation, pending update, attached
// schedule, and each item's Price and current period end. Any error,
// resource_missing included, is returned: it never proves the subscription
// ended.
func SubscriptionSnapshot(ctx context.Context, sc *stripeSDK.Client, subscriptionID string) (snapshot.Live, error) {
	sub, err := sc.V1Subscriptions.Retrieve(ctx, subscriptionID, nil)
	if err != nil {
		return snapshot.Live{}, fmt.Errorf("billing/stripe: retrieve subscription %s: %w", subscriptionID, err)
	}
	live := snapshot.Live{Live: eligibility.Live{
		Status:            string(sub.Status),
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
		CancelAt:          sub.CancelAt,
		PendingUpdate:     sub.PendingUpdate != nil,
		HasSchedule:       sub.Schedule != nil && sub.Schedule.ID != "",
	}}
	if sub.Items == nil {
		return live, nil
	}
	live.ItemsComplete = !sub.Items.HasMore
	for _, item := range sub.Items.Data {
		if item.Price != nil {
			live.PriceIDs = append(live.PriceIDs, item.Price.ID)
		}
		live.CurrentPeriodEnd = max(live.CurrentPeriodEnd, item.CurrentPeriodEnd)
	}
	return live, nil
}

// CancelSubscriptionNow ends a subscription immediately, with no proration
// credit and no final invoice: used when its payment was refunded, so the
// money is already settled (ADR-049 Decision 8). Canceling one that is
// already gone counts as done -- Stripe answers resource_missing for a
// canceled subscription (checked in the sandbox, 2026-10-16).
func CancelSubscriptionNow(ctx context.Context, sc *stripeSDK.Client, subscriptionID string) error {
	_, err := sc.V1Subscriptions.Cancel(ctx, subscriptionID, &stripeSDK.SubscriptionCancelParams{
		Prorate:    stripeSDK.Bool(false),
		InvoiceNow: stripeSDK.Bool(false),
	})
	var stripeErr *stripeSDK.Error
	if errors.As(err, &stripeErr) && stripeErr.Code == stripeSDK.ErrorCodeResourceMissing {
		return nil
	}
	return err
}
