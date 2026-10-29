package stripe

import (
	"context"
	"errors"
	"fmt"
	"slices"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

var (
	// ErrPortalConfigurationMissing: Stripe has no configuration to resolve.
	ErrPortalConfigurationMissing = errors.New("billing/stripe: no matching active Customer Portal configuration exists")
	// ErrPortalConfigurationUnsafe: the configuration is ambiguous or breaks
	// the policy ENX requires of it.
	ErrPortalConfigurationUnsafe = errors.New("billing/stripe: Customer Portal configuration is ambiguous or unsafe")
)

// RestrictedPortalMetadataKey/Value mark the restricted configuration when no
// explicit ID is configured (w10n-config portal-config.py sets them).
const (
	RestrictedPortalMetadataKey   = "enx_portal"
	RestrictedPortalMetadataValue = "restricted"
)

func unsafe(cfg *stripeSDK.BillingPortalConfiguration, reason string) error {
	return fmt.Errorf("%w: %s %s", ErrPortalConfigurationUnsafe, cfg.ID, reason)
}

// checkCommonPortalFeatures holds what both configurations keep: an active
// configuration with period-end cancellation, payment-method update and
// invoice history.
func checkCommonPortalFeatures(cfg *stripeSDK.BillingPortalConfiguration) error {
	if cfg.ID == "" || !cfg.Active {
		return unsafe(cfg, "is inactive")
	}
	f := cfg.Features
	if f == nil || f.SubscriptionUpdate == nil {
		return unsafe(cfg, "has no features")
	}
	if f.SubscriptionCancel == nil || !f.SubscriptionCancel.Enabled || f.SubscriptionCancel.Mode != stripeSDK.BillingPortalConfigurationFeaturesSubscriptionCancelModeAtPeriodEnd {
		return unsafe(cfg, "does not cancel at period end")
	}
	if f.PaymentMethodUpdate == nil || !f.PaymentMethodUpdate.Enabled {
		return unsafe(cfg, "has payment-method update off")
	}
	if f.InvoiceHistory == nil || !f.InvoiceHistory.Enabled {
		return unsafe(cfg, "has invoice history off")
	}
	return nil
}

// CheckPlanChangePortalConfiguration enforces ADR-067's plan-change policy:
// switching on with always_invoice upgrades, period-end downgrades
// (decreasing_item_amount), Price as the only allowed update, one fixed-
// quantity product entry per tier listing only that tier's Price, and
// exactly ENX's tier Prices across the entries. tierPrices maps each tier to
// its Price ID.
func CheckPlanChangePortalConfiguration(cfg *stripeSDK.BillingPortalConfiguration, tierPrices map[string]string) error {
	if err := checkCommonPortalFeatures(cfg); err != nil {
		return err
	}
	u := cfg.Features.SubscriptionUpdate
	if !u.Enabled {
		return unsafe(cfg, "has plan switching off")
	}
	if u.ProrationBehavior != stripeSDK.BillingPortalConfigurationFeaturesSubscriptionUpdateProrationBehaviorAlwaysInvoice {
		return unsafe(cfg, "does not invoice upgrades at once")
	}
	if u.ScheduleAtPeriodEnd == nil || !slices.ContainsFunc(u.ScheduleAtPeriodEnd.Conditions, func(c *stripeSDK.BillingPortalConfigurationFeaturesSubscriptionUpdateScheduleAtPeriodEndCondition) bool {
		return c != nil && c.Type == stripeSDK.BillingPortalConfigurationFeaturesSubscriptionUpdateScheduleAtPeriodEndConditionTypeDecreasingItemAmount
	}) {
		return unsafe(cfg, "does not schedule downgrades at period end")
	}
	if len(u.DefaultAllowedUpdates) != 1 || u.DefaultAllowedUpdates[0] != stripeSDK.BillingPortalConfigurationFeaturesSubscriptionUpdateDefaultAllowedUpdatePrice {
		return unsafe(cfg, "allows updates other than exactly price")
	}

	want := map[string]bool{}
	for _, price := range tierPrices {
		if price != "" {
			want[price] = true
		}
	}
	if len(want) == 0 {
		return unsafe(cfg, "cannot be checked without ENX's tier Prices")
	}
	seen := map[string]bool{}
	for _, p := range u.Products {
		if p == nil || len(p.Prices) != 1 {
			return unsafe(cfg, "has a product entry without exactly one Price")
		}
		if p.AdjustableQuantity != nil && p.AdjustableQuantity.Enabled {
			return unsafe(cfg, "lets the customer adjust quantity")
		}
		price := p.Prices[0]
		if !want[price] || seen[price] {
			return unsafe(cfg, "lists a Price that is not one of ENX's tier Prices exactly once")
		}
		seen[price] = true
	}
	if len(seen) != len(want) {
		return unsafe(cfg, "does not list every ENX tier Price")
	}
	return nil
}

// CheckRestrictedPortalConfiguration enforces the policy for blocked users'
// sessions: plan switching off, the common features on.
func CheckRestrictedPortalConfiguration(cfg *stripeSDK.BillingPortalConfiguration) error {
	if err := checkCommonPortalFeatures(cfg); err != nil {
		return err
	}
	if cfg.Features.SubscriptionUpdate.Enabled {
		return unsafe(cfg, "has plan switching on")
	}
	return nil
}

// ResolvePlanChangePortalConfiguration selects the explicit override, never
// falling back, or the account/mode's single active default, then checks it
// with CheckPlanChangePortalConfiguration. It returns the checked ID so the
// session is pinned to it even if the default changes meanwhile.
func ResolvePlanChangePortalConfiguration(ctx context.Context, sc *stripeSDK.Client, overrideID string, tierPrices map[string]string) (string, error) {
	var cfg *stripeSDK.BillingPortalConfiguration
	if overrideID != "" {
		var err error
		if cfg, err = retrievePortalConfiguration(ctx, sc, overrideID); err != nil {
			return "", err
		}
	} else {
		configs := sc.V1BillingPortalConfigurations.List(ctx, &stripeSDK.BillingPortalConfigurationListParams{
			Active: stripeSDK.Bool(true), IsDefault: stripeSDK.Bool(true),
			Expand:     []*string{stripeSDK.String("data.features.subscription_update.products")},
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
	}
	if err := CheckPlanChangePortalConfiguration(cfg, tierPrices); err != nil {
		return "", err
	}
	return cfg.ID, nil
}

// ResolveRestrictedPortalConfiguration selects the explicit override, never
// falling back, or the single active configuration tagged
// enx_portal=restricted, then checks it with
// CheckRestrictedPortalConfiguration.
func ResolveRestrictedPortalConfiguration(ctx context.Context, sc *stripeSDK.Client, overrideID string) (string, error) {
	var cfg *stripeSDK.BillingPortalConfiguration
	if overrideID != "" {
		var err error
		if cfg, err = retrievePortalConfiguration(ctx, sc, overrideID); err != nil {
			return "", err
		}
	} else {
		var matches []*stripeSDK.BillingPortalConfiguration
		for c, err := range sc.V1BillingPortalConfigurations.List(ctx, &stripeSDK.BillingPortalConfigurationListParams{
			Active: stripeSDK.Bool(true),
		}).All(ctx) {
			if err != nil {
				return "", fmt.Errorf("billing/stripe: find restricted Customer Portal configuration: %w", err)
			}
			if c.Metadata[RestrictedPortalMetadataKey] == RestrictedPortalMetadataValue {
				matches = append(matches, c)
			}
		}
		switch len(matches) {
		case 0:
			return "", ErrPortalConfigurationMissing
		case 1:
			cfg = matches[0]
		default:
			return "", fmt.Errorf("%w: %d configurations tagged %s=%s", ErrPortalConfigurationUnsafe, len(matches), RestrictedPortalMetadataKey, RestrictedPortalMetadataValue)
		}
	}
	if err := CheckRestrictedPortalConfiguration(cfg); err != nil {
		return "", err
	}
	return cfg.ID, nil
}

func retrievePortalConfiguration(ctx context.Context, sc *stripeSDK.Client, id string) (*stripeSDK.BillingPortalConfiguration, error) {
	cfg, err := sc.V1BillingPortalConfigurations.Retrieve(ctx, id, &stripeSDK.BillingPortalConfigurationRetrieveParams{
		Expand: []*string{stripeSDK.String("features.subscription_update.products")},
	})
	if err != nil {
		return nil, fmt.Errorf("billing/stripe: retrieve Customer Portal configuration %s: %w", id, err)
	}
	return cfg, nil
}

// TierPriceIDs resolves each tier's lookup_key to its Price ID. Every tier
// must resolve: a plan-change configuration cannot be checked otherwise.
func TierPriceIDs(ctx context.Context, sc *stripeSDK.Client, tierLookupKeys map[string]string) (map[string]string, error) {
	ids := make(map[string]string, len(PlanTiers))
	for _, tier := range PlanTiers {
		lookupKey := tierLookupKeys[tier]
		if lookupKey == "" {
			return nil, fmt.Errorf("billing/stripe: no lookup_key configured for tier %s", tier)
		}
		price, err := PriceForLookupKey(ctx, sc, lookupKey)
		if err != nil {
			return nil, err
		}
		ids[tier] = price.ID
	}
	return ids, nil
}

// CreatePortalSession creates a Stripe Customer Portal session under the
// given checked configuration, so the user can cancel, update payment
// methods, see invoices and, under the plan-change configuration, switch
// plans without ENX building that UI (ADR-009 Decision 1, ADR-067).
func CreatePortalSession(ctx context.Context, sc *stripeSDK.Client, customerID, configurationID, returnURL string) (*stripeSDK.BillingPortalSession, error) {
	return sc.V1BillingPortalSessions.Create(ctx, &stripeSDK.BillingPortalSessionCreateParams{
		Customer:      stripeSDK.String(customerID),
		Configuration: stripeSDK.String(configurationID),
		ReturnURL:     stripeSDK.String(returnURL),
	})
}
