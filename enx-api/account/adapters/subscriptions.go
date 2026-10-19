package adapters

import (
	"context"
	"errors"
	"fmt"

	"enx-api/account"
	billingstripe "enx-api/billing/stripe"
	"enx-api/utils/sqlitex"

	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
)

// Subscriptions is account.Subscriptions over the subscriptions table and
// Stripe. Stripe is nil when billing is off.
type Subscriptions struct {
	Stripe *stripeSDK.Client
}

var _ account.Subscriptions = Subscriptions{}

// liveStatuses are the local statuses under which Stripe may still bill.
var liveStatuses = map[string]bool{"active": true, "trialing": true, "past_due": true}

// Renewing asks Stripe only when the local row says the subscription is
// live: the table does not keep cancel_at_period_end, so a subscription
// canceled for the end of its period still reads active (ADR-062
// Decision 2).
func (s Subscriptions) Renewing(ctx context.Context, userID string) (bool, error) {
	var row sqlitex.Subscription
	err := sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !liveStatuses[row.Status] || row.StripeSubscriptionId == nil || *row.StripeSubscriptionId == "" {
		return false, nil
	}
	if s.Stripe == nil {
		return false, fmt.Errorf("account: subscription %s is %s but Stripe is not configured", *row.StripeSubscriptionId, row.Status)
	}
	sub, err := billingstripe.RetrieveSubscription(ctx, s.Stripe, *row.StripeSubscriptionId)
	var stripeErr *stripeSDK.Error
	if errors.As(err, &stripeErr) && stripeErr.Code == stripeSDK.ErrorCodeResourceMissing {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if sub.Status == stripeSDK.SubscriptionStatusCanceled || sub.Status == stripeSDK.SubscriptionStatusIncompleteExpired {
		return false, nil
	}
	return !sub.CancelAtPeriodEnd, nil
}
