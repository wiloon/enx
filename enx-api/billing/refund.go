package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/email"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
)

// handleChargeRefunded takes back the credits a refunded payment bought
// (ADR-049 Decision 7).
func (h *Handler) handleChargeRefunded(ctx context.Context, event stripeSDK.Event) error {
	var charge stripeSDK.Charge
	if err := json.Unmarshal(event.Data.Raw, &charge); err != nil {
		return fmt.Errorf("unmarshal charge.refunded: %w", err)
	}
	var paymentIntentID string
	if charge.PaymentIntent != nil {
		paymentIntentID = charge.PaymentIntent.ID
	}

	result, err := credit.Clawback(ctx, paymentIntentID, charge.AmountRefunded, charge.AmountCaptured, event.ID)
	if errors.Is(err, credit.ErrGrantNotFound) {
		// Retrying won't make a grant appear, so succeed and tell a human.
		logger.Errorf("charge.refunded %s: no credit grant for payment intent %q (charge %s); nothing clawed back", event.ID, paymentIntentID, charge.ID)
		h.notifyUnmatchedRefund(email.UnmatchedRefundNotify{
			EventID:         event.ID,
			ChargeID:        charge.ID,
			PaymentIntentID: paymentIntentID,
			AmountRefunded:  charge.AmountRefunded,
			Currency:        string(charge.Currency),
		})
		return nil
	}
	if err != nil {
		return err
	}

	// A refunded subscription payment ends the subscription (ADR-049
	// Decision 8). This runs on a replay too -- Clawback is idempotent and
	// still reports the grant -- so a cancel that failed is retried when
	// Stripe redelivers. The local status follows customer.subscription.deleted.
	if result.GrantType == credit.TypeGrantSubscription {
		if err := h.cancelRefundedSubscription(ctx, result.UserID); err != nil {
			return fmt.Errorf("charge.refunded %s: cancel subscription of user %s: %w", event.ID, result.UserID, err)
		}
	}
	return nil
}

// cancelRefundedSubscription cancels userID's subscription in Stripe now,
// unless Stripe says it has already ended.
func (h *Handler) cancelRefundedSubscription(ctx context.Context, userID string) error {
	var sub sqlitex.Subscription
	err := sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&sub).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && sub.StripeSubscriptionId == nil) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load subscription: %w", err)
	}
	subscriptionID := *sub.StripeSubscriptionId
	live, err := billingstripe.RetrieveSubscription(ctx, h.sc, subscriptionID)
	if err != nil {
		return fmt.Errorf("retrieve subscription %s: %w", subscriptionID, err)
	}
	switch live.Status {
	case stripeSDK.SubscriptionStatusActive, stripeSDK.SubscriptionStatusTrialing, stripeSDK.SubscriptionStatusPastDue:
		return billingstripe.CancelSubscriptionNow(ctx, h.sc, subscriptionID)
	default:
		return nil
	}
}

func (h *Handler) notifyUnmatchedRefund(n email.UnmatchedRefundNotify) {
	if h.refunds == nil {
		return
	}
	if err := h.refunds.NotifyAdminUnmatchedRefund(n); err != nil {
		logger.Errorf("charge.refunded %s: notify admin: %v", n.EventID, err)
	}
}
