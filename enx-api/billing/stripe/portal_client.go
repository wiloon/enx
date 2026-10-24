package stripe

import (
	"context"
	"fmt"

	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// PortalClient is Stripe as portalsession.Service sees it.
type PortalClient struct {
	sc                   *stripeSDK.Client
	planChangeOverrideID string
	restrictedOverrideID string
	tierLookupKeys       map[string]string
}

// NewPortalClient returns a PortalClient over sc. The override IDs are the
// optional stripe.portal-configuration-id and
// stripe.portal-restricted-configuration-id; tierLookupKeys maps each tier
// to its Price lookup_key.
func NewPortalClient(sc *stripeSDK.Client, planChangeOverrideID, restrictedOverrideID string, tierLookupKeys map[string]string) *PortalClient {
	return &PortalClient{sc: sc, planChangeOverrideID: planChangeOverrideID, restrictedOverrideID: restrictedOverrideID, tierLookupKeys: tierLookupKeys}
}

// Subscription is the subscription's live state and its items. Any error,
// resource_missing included, is returned: it never proves the subscription
// ended.
func (c *PortalClient) Subscription(ctx context.Context, subscriptionID string) (portalsession.Subscription, error) {
	sub, err := RetrieveSubscription(ctx, c.sc, subscriptionID)
	if err != nil {
		return portalsession.Subscription{}, fmt.Errorf("billing/stripe: retrieve subscription %s: %w", subscriptionID, err)
	}
	out := portalsession.Subscription{Live: eligibility.Live{
		Status:            string(sub.Status),
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
		CancelAt:          sub.CancelAt,
		PendingUpdate:     sub.PendingUpdate != nil,
		HasSchedule:       sub.Schedule != nil && sub.Schedule.ID != "",
	}}
	if sub.Items == nil {
		return out, nil
	}
	out.ItemsComplete = !sub.Items.HasMore
	for _, item := range sub.Items.Data {
		priceID := ""
		if item.Price != nil {
			priceID = item.Price.ID
		}
		out.Items = append(out.Items, portalsession.Item{ID: item.ID, PriceID: priceID})
		out.CurrentPeriodEnd = max(out.CurrentPeriodEnd, item.CurrentPeriodEnd)
	}
	return out, nil
}

// TierPrices resolves each tier's lookup_key to its Price ID.
func (c *PortalClient) TierPrices(ctx context.Context) (map[string]string, error) {
	return TierPriceIDs(ctx, c.sc, c.tierLookupKeys)
}

// PlanChangeConfiguration resolves and checks the plan-change configuration.
func (c *PortalClient) PlanChangeConfiguration(ctx context.Context, tierPrices map[string]string) (string, error) {
	return ResolvePlanChangePortalConfiguration(ctx, c.sc, c.planChangeOverrideID, tierPrices)
}

// RestrictedConfiguration resolves and checks the restricted configuration.
func (c *PortalClient) RestrictedConfiguration(ctx context.Context) (string, error) {
	return ResolveRestrictedPortalConfiguration(ctx, c.sc, c.restrictedOverrideID)
}

// CreateSession creates the Portal session and returns its URL. A plan
// change opens Stripe's subscription_update_confirm page for the existing
// item and the target Price, at quantity 1, and returns to ReturnURL once
// the user confirms.
func (c *PortalClient) CreateSession(ctx context.Context, s portalsession.Session) (string, error) {
	params := &stripeSDK.BillingPortalSessionCreateParams{
		Customer:      stripeSDK.String(s.CustomerID),
		Configuration: stripeSDK.String(s.ConfigurationID),
		ReturnURL:     stripeSDK.String(s.ReturnURL),
	}
	if pc := s.PlanChange; pc != nil {
		params.FlowData = &stripeSDK.BillingPortalSessionCreateFlowDataParams{
			Type: stripeSDK.String(string(stripeSDK.BillingPortalSessionFlowTypeSubscriptionUpdateConfirm)),
			SubscriptionUpdateConfirm: &stripeSDK.BillingPortalSessionCreateFlowDataSubscriptionUpdateConfirmParams{
				Subscription: stripeSDK.String(pc.SubscriptionID),
				Items: []*stripeSDK.BillingPortalSessionCreateFlowDataSubscriptionUpdateConfirmItemParams{{
					ID:       stripeSDK.String(pc.ItemID),
					Price:    stripeSDK.String(pc.PriceID),
					Quantity: stripeSDK.Int64(1),
				}},
			},
			AfterCompletion: &stripeSDK.BillingPortalSessionCreateFlowDataAfterCompletionParams{
				Type: stripeSDK.String(string(stripeSDK.BillingPortalSessionFlowAfterCompletionTypeRedirect)),
				Redirect: &stripeSDK.BillingPortalSessionCreateFlowDataAfterCompletionRedirectParams{
					ReturnURL: stripeSDK.String(s.ReturnURL),
				},
			},
		}
	}
	session, err := c.sc.V1BillingPortalSessions.Create(ctx, params)
	if err != nil {
		return "", fmt.Errorf("billing/stripe: create Customer Portal session: %w", err)
	}
	return session.URL, nil
}
