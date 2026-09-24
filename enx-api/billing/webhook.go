package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/utils/sqlitex"

	"github.com/spf13/viper"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
)

// dispatchWebhookEvent routes a verified Stripe event to its handler. See
// docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §3.1 for the
// event -> action table this implements. Event types not in that table are
// not an error: the webhook endpoint itself is scoped in OpenTofu to only
// the 5 event types below (see infra/stripe/opentofu/enx, w10n-config), so
// this default case is a safety net more than an expected path.
func (h *Handler) dispatchWebhookEvent(ctx context.Context, event stripeSDK.Event) error {
	switch event.Type {
	case stripeSDK.EventTypeCheckoutSessionCompleted:
		return h.handleCheckoutSessionCompleted(ctx, event)
	case stripeSDK.EventTypeInvoicePaid:
		return h.handleInvoicePaid(ctx, event)
	case stripeSDK.EventTypeCustomerSubscriptionUpdated,
		stripeSDK.EventTypeCustomerSubscriptionDeleted:
		return h.handleSubscriptionChanged(ctx, event)
	case stripeSDK.EventTypeInvoicePaymentFailed:
		return h.handleInvoicePaymentFailed(ctx, event)
	default:
		return nil
	}
}

// handleCheckoutSessionCompleted establishes/updates the local
// user<->Stripe customer mapping. For a top-up purchase it also grants the
// credits; for a subscription purchase it deliberately does NOT grant
// credits here -- that's invoice.paid's job (TASK-SPEC §3.1), so the first
// period and every renewal go through the same code path.
func (h *Handler) handleCheckoutSessionCompleted(ctx context.Context, event stripeSDK.Event) error {
	var session stripeSDK.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return fmt.Errorf("unmarshal checkout.session.completed: %w", err)
	}

	userID := session.ClientReferenceID
	if userID == "" {
		return fmt.Errorf("checkout.session.completed %s: missing client_reference_id", session.ID)
	}
	var customerID string
	if session.Customer != nil {
		customerID = session.Customer.ID
	}
	if customerID == "" {
		return fmt.Errorf("checkout.session.completed %s: missing customer", session.ID)
	}

	if session.Metadata["type"] == "topup" {
		tier := session.Metadata["tier"]
		amount := viper.GetInt64("stripe.credits.topup-" + tier)
		if amount <= 0 {
			return fmt.Errorf("checkout.session.completed %s: stripe.credits.topup-%s is not configured (or tier metadata missing)", session.ID, tier)
		}
		if err := upsertSubscription(userID, customerID, "", "", "", 0); err != nil {
			return err
		}
		return credit.GrantTopup(ctx, userID, amount, event.ID)
	}

	var subscriptionID string
	if session.Subscription != nil {
		subscriptionID = session.Subscription.ID
	}
	if subscriptionID == "" {
		return fmt.Errorf("checkout.session.completed %s: subscription checkout without a subscription", session.ID)
	}
	// Status comes from Stripe, not an assumed "active": a redelivery of this
	// event can arrive after the subscription was already canceled (see
	// syncSubscriptionState). Plan comes from the checkout session's
	// metadata (set by CheckoutSubscription); invoice.paid re-resolves and
	// overwrites it from the price ID on every renewal, so this is only a
	// best-effort value for the UI until the first invoice lands.
	live, err := billingstripe.RetrieveSubscription(ctx, h.sc, subscriptionID)
	if err != nil {
		return fmt.Errorf("checkout.session.completed %s: retrieve subscription %s: %w", session.ID, subscriptionID, err)
	}
	return upsertSubscription(userID, customerID, subscriptionID, string(live.Status), session.Metadata["plan"], subscriptionPeriodEnd(live))
}

// handleInvoicePaid is the sole trigger for granting subscription credits
// (ADR-009 Decision 5/D2): it resets subscription_balance to this period's
// allotment rather than adding to it, so unused credit doesn't carry over.
// Fires for both the first period and every renewal.
func (h *Handler) handleInvoicePaid(ctx context.Context, event stripeSDK.Event) error {
	var inv stripeSDK.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		return fmt.Errorf("unmarshal invoice.paid: %w", err)
	}

	subscriptionID := invoiceSubscriptionID(&inv)
	if subscriptionID == "" {
		return nil // one-off invoice, not a subscription renewal -- nothing for the ledger to do
	}

	userID, err := userIDForStripeSubscription(subscriptionID)
	if err != nil {
		return err
	}

	if inv.Lines == nil || len(inv.Lines.Data) == 0 {
		return fmt.Errorf("invoice.paid %s: no line items", inv.ID)
	}
	var priceID string
	if line := inv.Lines.Data[0]; line.Pricing != nil && line.Pricing.PriceDetails != nil && line.Pricing.PriceDetails.Price != nil {
		priceID = line.Pricing.PriceDetails.Price.ID
	}

	tierLookupKeys := map[string]string{
		"pro":      viper.GetString("stripe.price.pro"),
		"pro-plus": viper.GetString("stripe.price.pro-plus"),
		"max":      viper.GetString("stripe.price.max"),
	}
	plan, err := billingstripe.SubscriptionTierForPrice(ctx, h.sc, priceID, tierLookupKeys)
	if err != nil {
		return fmt.Errorf("invoice.paid %s: resolve plan for price %q: %w", inv.ID, priceID, err)
	}
	if plan == "" {
		return fmt.Errorf("invoice.paid %s: price %q matches no configured subscription tier", inv.ID, priceID)
	}

	amount := viper.GetInt64("stripe.credits.subscription-" + plan)
	if err := credit.GrantSubscription(ctx, userID, amount, time.Unix(inv.PeriodEnd, 0), event.ID); err != nil {
		return err
	}

	if err := updateSubscriptionBySubscriptionID(subscriptionID, map[string]interface{}{
		"plan":       plan,
		"updated_at": time.Now().UnixMilli(),
	}); err != nil {
		return err
	}
	return h.syncSubscriptionState(ctx, subscriptionID)
}

// handleSubscriptionChanged handles customer.subscription.updated and
// customer.subscription.deleted. The payload is only used for the
// subscription id; the state written comes from Stripe (see
// syncSubscriptionState).
func (h *Handler) handleSubscriptionChanged(ctx context.Context, event stripeSDK.Event) error {
	var sub stripeSDK.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("unmarshal %s: %w", event.Type, err)
	}
	if sub.ID == "" {
		return fmt.Errorf("%s %s: missing subscription id", event.Type, event.ID)
	}
	return h.syncSubscriptionState(ctx, sub.ID)
}

func (h *Handler) handleInvoicePaymentFailed(ctx context.Context, event stripeSDK.Event) error {
	var inv stripeSDK.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		return fmt.Errorf("unmarshal invoice.payment_failed: %w", err)
	}
	subscriptionID := invoiceSubscriptionID(&inv)
	if subscriptionID == "" {
		return nil // one-off invoice, not a subscription -- nothing to update
	}
	return h.syncSubscriptionState(ctx, subscriptionID)
}

// syncSubscriptionState copies a subscription's CURRENT status and period
// end from Stripe into the local row. Stripe does not guarantee event
// order, and a delivery that failed is retried later, so an event's payload
// can be older than the state already stored -- e.g. a stale
// customer.subscription.updated ("active") processed after
// customer.subscription.deleted would otherwise resurrect a canceled
// subscription for good, since no later event would correct it. Reading
// the live object makes every subscription event converge on Stripe's
// state regardless of the order they arrive in.
func (h *Handler) syncSubscriptionState(ctx context.Context, subscriptionID string) error {
	live, err := billingstripe.RetrieveSubscription(ctx, h.sc, subscriptionID)
	if err != nil {
		return fmt.Errorf("retrieve subscription %s: %w", subscriptionID, err)
	}
	updates := map[string]interface{}{
		"status":     string(live.Status),
		"updated_at": time.Now().UnixMilli(),
	}
	if end := subscriptionPeriodEnd(live); end > 0 {
		updates["current_period_end"] = end
	}
	return updateSubscriptionBySubscriptionID(subscriptionID, updates)
}

// subscriptionPeriodEnd is the subscription's current period end (Unix
// seconds), which Stripe reports per item; 0 when there are no items.
func subscriptionPeriodEnd(sub *stripeSDK.Subscription) int64 {
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		return sub.Items.Data[0].CurrentPeriodEnd
	}
	return 0
}

func invoiceSubscriptionID(inv *stripeSDK.Invoice) string {
	if inv.Parent != nil && inv.Parent.SubscriptionDetails != nil && inv.Parent.SubscriptionDetails.Subscription != nil {
		return inv.Parent.SubscriptionDetails.Subscription.ID
	}
	return ""
}

func userIDForStripeSubscription(subscriptionID string) (string, error) {
	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("stripe_subscription_id = ?", subscriptionID).First(&sub).Error; err != nil {
		return "", fmt.Errorf("no local subscription row for stripe_subscription_id %q: %w", subscriptionID, err)
	}
	return sub.UserId, nil
}

// upsertSubscription creates or updates the subscriptions row for userID.
// Empty subscriptionID/status/plan/currentPeriodEnd values are left
// untouched on an existing row (a top-up-only checkout, for example, has
// none of those to set).
func upsertSubscription(userID, customerID, subscriptionID, status, plan string, currentPeriodEnd int64) error {
	now := time.Now().UnixMilli()

	var existing sqlitex.Subscription
	err := sqlitex.DB.Where("user_id = ?", userID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row := sqlitex.Subscription{
			UserId:           userID,
			StripeCustomerId: customerID,
			Status:           status,
			Plan:             plan,
			CurrentPeriodEnd: currentPeriodEnd,
			CreatedAt:        now,
			UpdatedAt:        now,
		}
		if row.Status == "" {
			row.Status = "none"
		}
		if subscriptionID != "" {
			row.StripeSubscriptionId = &subscriptionID
		}
		return sqlitex.DB.Create(&row).Error
	}
	if err != nil {
		return err
	}

	updates := map[string]interface{}{
		"stripe_customer_id": customerID,
		"updated_at":         now,
	}
	if status != "" {
		updates["status"] = status
	}
	if plan != "" {
		updates["plan"] = plan
	}
	if subscriptionID != "" {
		updates["stripe_subscription_id"] = subscriptionID
	}
	if currentPeriodEnd > 0 {
		updates["current_period_end"] = currentPeriodEnd
	}
	return sqlitex.DB.Model(&sqlitex.Subscription{}).Where("user_id = ?", userID).Updates(updates).Error
}

// updateSubscriptionBySubscriptionID updates the subscriptions row matching
// a Stripe subscription id. Returns an error (not a silent no-op) when no
// row matches: Stripe doesn't guarantee event ordering, so this can
// legitimately happen if e.g. customer.subscription.updated arrives before
// checkout.session.completed has been processed -- returning an error here
// makes the caller respond non-2xx so Stripe retries, which resolves once
// the missing event lands.
func updateSubscriptionBySubscriptionID(subscriptionID string, updates map[string]interface{}) error {
	result := sqlitex.DB.Model(&sqlitex.Subscription{}).
		Where("stripe_subscription_id = ?", subscriptionID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("no local subscription row for stripe_subscription_id %q", subscriptionID)
	}
	return nil
}
