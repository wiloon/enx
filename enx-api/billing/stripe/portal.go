package stripe

import (
	"context"
	"errors"
	"fmt"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

var (
	// ErrPortalConfigurationMissing: Stripe has no active default configuration.
	ErrPortalConfigurationMissing = errors.New("billing/stripe: no active default Customer Portal configuration exists")
	// ErrPortalConfigurationUnsafe: the configuration is inactive or lets the
	// customer change their subscription's price.
	ErrPortalConfigurationUnsafe = errors.New("billing/stripe: Customer Portal configuration is inactive or allows subscription updates")
)

// ResolvePortalConfiguration selects the explicit override or Stripe's active
// default in the current key's account/mode. Both must have subscription updates
// disabled until ENX's payment-confirmed plan-change/credit flow is available.
// Return the checked ID so a concurrent default change cannot select a different
// configuration when the caller creates its session.
func ResolvePortalConfiguration(ctx context.Context, sc *stripeSDK.Client, configurationID string) (string, error) {
	var cfg *stripeSDK.BillingPortalConfiguration
	if configurationID == "" {
		configs := sc.V1BillingPortalConfigurations.List(ctx, &stripeSDK.BillingPortalConfigurationListParams{
			Active: stripeSDK.Bool(true), IsDefault: stripeSDK.Bool(true),
			ListParams: stripeSDK.ListParams{Limit: stripeSDK.Int64(2)},
		})
		if err := configs.Err(); err != nil {
			return "", fmt.Errorf("billing/stripe: find default Customer Portal configuration: %w", err)
		}
		if len(configs.Data()) == 0 && !configs.Meta().HasMore {
			return "", ErrPortalConfigurationMissing
		}
		if len(configs.Data()) != 1 || configs.Meta().HasMore || !configs.Data()[0].IsDefault {
			return "", fmt.Errorf("%w: no unique default", ErrPortalConfigurationUnsafe)
		}
		cfg = configs.Data()[0]
	} else {
		var err error
		cfg, err = sc.V1BillingPortalConfigurations.Retrieve(ctx, configurationID, nil)
		if err != nil {
			return "", fmt.Errorf("billing/stripe: retrieve Customer Portal configuration %s: %w", configurationID, err)
		}
	}
	if cfg.ID == "" || !cfg.Active || cfg.Features == nil || cfg.Features.SubscriptionUpdate == nil || cfg.Features.SubscriptionUpdate.Enabled {
		return "", fmt.Errorf("%w: %s", ErrPortalConfigurationUnsafe, cfg.ID)
	}
	return cfg.ID, nil
}

// CreatePortalSession creates a Stripe Customer Portal session under the
// given configuration, so the user can cancel their subscription, update
// payment methods and see invoices without ENX building that UI (ADR-009
// Decision 1). Plan changes are not offered there: see
// ResolvePortalConfiguration.
func CreatePortalSession(ctx context.Context, sc *stripeSDK.Client, customerID, configurationID, returnURL string) (*stripeSDK.BillingPortalSession, error) {
	return sc.V1BillingPortalSessions.Create(ctx, &stripeSDK.BillingPortalSessionCreateParams{
		Customer:      stripeSDK.String(customerID),
		Configuration: stripeSDK.String(configurationID),
		ReturnURL:     stripeSDK.String(returnURL),
	})
}
