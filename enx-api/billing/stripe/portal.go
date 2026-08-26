package stripe

import (
	"context"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// CreatePortalSession creates a Stripe Customer Portal session so the user
// can manage/cancel their subscription or update payment methods without
// enx building its own billing management UI (ADR-009 Decision 1).
func CreatePortalSession(ctx context.Context, sc *stripeSDK.Client, customerID, returnURL string) (*stripeSDK.BillingPortalSession, error) {
	return sc.V1BillingPortalSessions.Create(ctx, &stripeSDK.BillingPortalSessionCreateParams{
		Customer:  stripeSDK.String(customerID),
		ReturnURL: stripeSDK.String(returnURL),
	})
}
