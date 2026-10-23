// Package adapters binds the referral domain to the credit ledger and
// Stripe.
package adapters

import (
	"context"
	"errors"
	"time"

	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/referral"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// Ledger is referral.CreditGranter over billing/credit. EmailHMAC looks up
// the invitee's email HMAC (repo.TrialGrants.EmailHMACOf), which the trial
// the bonus may issue first needs (ADR-062 Decision 3).
type Ledger struct {
	EmailHMAC func(ctx context.Context, userID string) (string, error)
}

var _ referral.CreditGranter = Ledger{}

func (l Ledger) GrantInviteeBonus(ctx context.Context, inviteeID string, b referral.Bonus) (time.Time, error) {
	emailHMAC, err := l.EmailHMAC(ctx, inviteeID)
	if err != nil {
		return time.Time{}, err
	}
	return credit.GrantReferralBonus(ctx, inviteeID, credit.ReferralBonus{
		Amount:      b.Amount,
		ExpiresAt:   b.ExpiresAt,
		TrialAmount: b.TrialAmount,
		TrialTTL:    b.TrialTTL,
		EmailHMAC:   emailHMAC,
	})
}

func (Ledger) GrantReferrerReward(ctx context.Context, referrerID string, amount int64, key string) error {
	err := credit.GrantReferralReward(ctx, referrerID, amount, key)
	if errors.Is(err, credit.ErrNoUser) {
		return referral.ErrReferrerDeleted
	}
	return err
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
