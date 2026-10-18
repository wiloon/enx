// Package adapters binds the referral domain to the credit ledger and
// Stripe.
package adapters

import (
	"context"
	"time"

	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/referral"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// Ledger is referral.CreditGranter over billing/credit.
type Ledger struct{}

var _ referral.CreditGranter = Ledger{}

func (Ledger) GrantInviteeBonus(ctx context.Context, inviteeID string, b referral.Bonus) (time.Time, error) {
	return credit.GrantReferralBonus(ctx, inviteeID, credit.ReferralBonus{
		Amount:      b.Amount,
		ExpiresAt:   b.ExpiresAt,
		TrialAmount: b.TrialAmount,
		TrialTTL:    b.TrialTTL,
	})
}

func (Ledger) GrantReferrerReward(ctx context.Context, referrerID string, amount int64, key string) error {
	return credit.GrantReferralReward(ctx, referrerID, amount, key)
}

// Stripe is referral.PaymentChecker over the Stripe API.
type Stripe struct {
	Client *stripeSDK.Client
}

var _ referral.PaymentChecker = Stripe{}

func (s Stripe) InvoicePaymentIntent(ctx context.Context, invoiceID string) (string, error) {
	return billingstripe.InvoicePaymentIntent(ctx, s.Client, invoiceID)
}

func (s Stripe) Charge(ctx context.Context, paymentIntentID string) (referral.ChargeState, error) {
	refunded, disputed, err := billingstripe.PaymentRefundedOrDisputed(ctx, s.Client, paymentIntentID)
	return referral.ChargeState{Refunded: refunded, Disputed: disputed}, err
}
