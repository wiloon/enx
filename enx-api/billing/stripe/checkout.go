package stripe

import (
	"context"
	"fmt"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// PriceForLookupKey resolves a Stripe Price by lookup_key. Prices are
// referenced by lookup_key rather than a raw Price ID because lookup_keys
// are stable across Sandbox/Live -- the underlying Price ID differs per
// Stripe mode, the lookup_key doesn't (see infra/stripe/opentofu/enx/README.md
// in w10n-config, private).
func PriceForLookupKey(ctx context.Context, sc *stripeSDK.Client, lookupKey string) (*stripeSDK.Price, error) {
	list := sc.V1Prices.List(ctx, &stripeSDK.PriceListParams{
		LookupKeys: stripeSDK.StringSlice([]string{lookupKey}),
	})
	for price, err := range list.All(ctx) {
		if err != nil {
			return nil, fmt.Errorf("billing/stripe: list prices for lookup_key %q: %w", lookupKey, err)
		}
		return price, nil
	}
	return nil, fmt.Errorf("billing/stripe: no price found for lookup_key %q", lookupKey)
}

// CheckoutSessionParams is the subset of Stripe Checkout Session creation
// fields enx actually uses, for both mode=subscription (enx Pro) and
// mode=payment (AI credit top-ups).
type CheckoutSessionParams struct {
	PriceLookupKey    string
	Mode              string // "subscription" | "payment"
	ClientReferenceID string // users.id (see ADR-009 Decision 1)
	CustomerEmail     string // prefill; only used when Customer is empty
	Customer          string // existing stripe_customer_id, reused if the user already has one
	SuccessURL        string
	CancelURL         string
	Metadata          map[string]string // e.g. {"type": "topup"} to distinguish from a subscription checkout (TASK-SPEC §3.1)
}

// CreateCheckoutSession creates a Stripe-hosted Checkout Session for either
// the enx Pro subscription or a one-time AI credit top-up.
func CreateCheckoutSession(ctx context.Context, sc *stripeSDK.Client, p CheckoutSessionParams) (*stripeSDK.CheckoutSession, error) {
	price, err := PriceForLookupKey(ctx, sc, p.PriceLookupKey)
	if err != nil {
		return nil, err
	}

	params := &stripeSDK.CheckoutSessionCreateParams{
		Mode:              stripeSDK.String(p.Mode),
		ClientReferenceID: stripeSDK.String(p.ClientReferenceID),
		SuccessURL:        stripeSDK.String(p.SuccessURL),
		CancelURL:         stripeSDK.String(p.CancelURL),
		LineItems: []*stripeSDK.CheckoutSessionCreateLineItemParams{
			{Price: stripeSDK.String(price.ID), Quantity: stripeSDK.Int64(1)},
		},
		Metadata: p.Metadata,
	}
	if p.Customer != "" {
		params.Customer = stripeSDK.String(p.Customer)
	} else if p.CustomerEmail != "" {
		params.CustomerEmail = stripeSDK.String(p.CustomerEmail)
	}

	return sc.V1CheckoutSessions.Create(ctx, params)
}
