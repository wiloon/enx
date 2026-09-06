// Package stripe wraps the Stripe SDK for enx's billing needs: resolving
// Prices by lookup_key, creating Checkout Sessions (subscription + top-up),
// and Customer Portal sessions. See
// docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §2 for the
// package layout this implements.
package stripe

import (
	"fmt"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// New builds a Stripe SDK client from a secret key. Returns a non-nil error
// if secretKey is empty so callers can treat Stripe billing as an optional,
// unconfigured feature (same "unconfigured but not fatal" pattern as
// aitranslate.New when sentence-translate.provider is unset).
func New(secretKey string) (*stripeSDK.Client, error) {
	if secretKey == "" {
		return nil, fmt.Errorf("billing/stripe: STRIPE_SECRET_KEY is not set")
	}
	return stripeSDK.NewClient(secretKey), nil
}
