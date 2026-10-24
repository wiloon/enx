package stripe

import (
	"context"
	"errors"
	"fmt"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

var (
	// ErrPortalConfigurationMissing: no Portal configuration is set, so
	// sessions would fall back to the Dashboard default.
	ErrPortalConfigurationMissing = errors.New("billing/stripe: no Customer Portal configuration is set")
	// ErrPortalConfigurationUnsafe: the configuration is inactive or lets the
	// customer change their subscription's price.
	ErrPortalConfigurationUnsafe = errors.New("billing/stripe: Customer Portal configuration is inactive or allows subscription updates")
)

// CheckPortalConfiguration reads the Portal configuration with the
// configured key, which scopes it to that key's account and mode, and
// accepts it only if it is active with subscription updates disabled. ENX
// alone changes a subscription's tier (ADR-067 §Portal 边界与发票分类).
func CheckPortalConfiguration(ctx context.Context, sc *stripeSDK.Client, configurationID string) error {
	if configurationID == "" {
		return ErrPortalConfigurationMissing
	}
	cfg, err := sc.V1BillingPortalConfigurations.Retrieve(ctx, configurationID, nil)
	if err != nil {
		return fmt.Errorf("billing/stripe: retrieve Customer Portal configuration %s: %w", configurationID, err)
	}
	if !cfg.Active || cfg.Features == nil || cfg.Features.SubscriptionUpdate == nil || cfg.Features.SubscriptionUpdate.Enabled {
		return fmt.Errorf("%w: %s", ErrPortalConfigurationUnsafe, configurationID)
	}
	return nil
}

// CreatePortalSession creates a Stripe Customer Portal session under the
// given configuration, so the user can cancel their subscription, update
// payment methods and see invoices without ENX building that UI (ADR-009
// Decision 1). Plan changes are not offered there: see
// CheckPortalConfiguration.
func CreatePortalSession(ctx context.Context, sc *stripeSDK.Client, customerID, configurationID, returnURL string) (*stripeSDK.BillingPortalSession, error) {
	return sc.V1BillingPortalSessions.Create(ctx, &stripeSDK.BillingPortalSessionCreateParams{
		Customer:      stripeSDK.String(customerID),
		Configuration: stripeSDK.String(configurationID),
		ReturnURL:     stripeSDK.String(returnURL),
	})
}
