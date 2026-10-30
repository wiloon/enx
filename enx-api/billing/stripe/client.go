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

// New builds a Stripe SDK client. An empty apiBaseURL keeps Stripe SDK defaults.
// A configured endpoint routes every SDK backend to the same adapter.
func New(secretKey, apiBaseURL string) (*stripeSDK.Client, error) {
	if secretKey == "" {
		return nil, fmt.Errorf("billing/stripe: STRIPE_SECRET_KEY is not set")
	}
	if apiBaseURL == "" {
		return stripeSDK.NewClient(secretKey), nil
	}
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(apiBaseURL)})
	return stripeSDK.NewClient(secretKey, stripeSDK.WithBackends(&stripeSDK.Backends{
		API: backend, Connect: backend, Uploads: backend, MeterEvents: backend,
	})), nil
}
