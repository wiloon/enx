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
	case stripeSDK.EventTypeCustomerSubscriptionUpdated:
		return handleSubscriptionUpdated(event)
	case stripeSDK.EventTypeCustomerSubscriptionDeleted:
		return handleSubscriptionDeleted(event)
	case stripeSDK.EventTypeInvoicePaymentFailed:
		return handleInvoicePaymentFailed(event)
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
	// Provisional status: this fires on successful payment (enx has no free
	// trial, see monetization.md "Pay Up Front"), so "active" is a
	// reasonable initial value. customer.subscription.updated corrects it
	// with Stripe's authoritative state shortly after. Plan comes from the
	// checkout session's metadata (set by CheckoutSubscription); invoice.paid
	// re-resolves and overwrites it from the price ID on every renewal, so
	// this is only a best-effort value for the UI until the first invoice
	// lands.
	return upsertSubscription(userID, customerID, subscriptionID, "active", session.Metadata["plan"], 0)
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

	return updateSubscriptionBySubscriptionID(subscriptionID, map[string]interface{}{
		"status":             "active",
		"plan":               plan,
		"current_period_end": inv.PeriodEnd,
		"updated_at":         time.Now().UnixMilli(),
	})
}

func handleSubscriptionUpdated(event stripeSDK.Event) error {
	var sub stripeSDK.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("unmarshal customer.subscription.updated: %w", err)
	}

	updates := map[string]interface{}{
		"status":     string(sub.Status),
		"updated_at": time.Now().UnixMilli(),
	}
	if sub.Items != nil && len(sub.Items.Data) > 0 && sub.Items.Data[0].CurrentPeriodEnd > 0 {
		updates["current_period_end"] = sub.Items.Data[0].CurrentPeriodEnd
	}
	return updateSubscriptionBySubscriptionID(sub.ID, updates)
}

func handleSubscriptionDeleted(event stripeSDK.Event) error {
	var sub stripeSDK.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("unmarshal customer.subscription.deleted: %w", err)
	}
	return updateSubscriptionBySubscriptionID(sub.ID, map[string]interface{}{
		"status":     "canceled",
		"updated_at": time.Now().UnixMilli(),
	})
}

func handleInvoicePaymentFailed(event stripeSDK.Event) error {
	var inv stripeSDK.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		return fmt.Errorf("unmarshal invoice.payment_failed: %w", err)
	}
	subscriptionID := invoiceSubscriptionID(&inv)
	if subscriptionID == "" {
		return nil // one-off invoice, not a subscription -- nothing to mark past_due
	}
	return updateSubscriptionBySubscriptionID(subscriptionID, map[string]interface{}{
		"status":     "past_due",
		"updated_at": time.Now().UnixMilli(),
	})
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
