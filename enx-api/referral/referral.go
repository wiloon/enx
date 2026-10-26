// Package referral is the invite-link domain (ADR-051): every user has an
// invite code; a new account that claims one soon after sign-up gets bonus
// trial credits, and the referrer is rewarded once, for the invitee's first
// payment, after a cooling-off period with no refund or dispute, provided
// the referrer has not deleted their account by then.
//
// The rules live in Service. Storage, the credit ledger, Stripe, the clock
// and the configured numbers come in through the interfaces below, so the
// rules run in unit tests on fakes.
package referral

import (
	"context"
	"errors"
	"time"
)

// Status is where a referral stands.
type Status string

const (
	// StatusClaimed: the invitee claimed the code and has not paid yet.
	StatusClaimed Status = "claimed"
	// StatusPending: the first payment is recorded; the reward waits for
	// its due date.
	StatusPending Status = "pending"
	// StatusRewarded: the referrer got the reward.
	StatusRewarded Status = "rewarded"
	// StatusForfeited: the payment was refunded or disputed, or the
	// referrer deleted their account (ForfeitReason referrer_deleted); no
	// reward.
	StatusForfeited Status = "forfeited"
	// StatusNoReward: the first payment is recorded, but no reward is due:
	// the reward for its kind was configured off (0) at the time, or the
	// referral's rewards were blocked at claim time (RewardsBlocked).
	StatusNoReward Status = "no_reward"
)

// PaymentKind is what the invitee's first payment bought.
type PaymentKind string

const (
	KindSubscription PaymentKind = "subscription"
	KindTopup        PaymentKind = "topup"
)

// Referral is one invitee's claim of a referrer's code: at most one per
// invitee, for life.
type Referral struct {
	InviteeID  string
	ReferrerID string
	Code       string
	ClaimedAt  time.Time
	Status     Status
	// RewardsBlocked: the invitee's email had a trial on an earlier,
	// deleted account (ADR-062 Decision 3), so neither side is rewarded.
	RewardsBlocked bool

	// FirstPayment is nil until the invitee pays.
	FirstPayment *FirstPayment
	// RewardAmount is computed when the first payment is recorded, so a
	// later config change does not touch a queued reward.
	RewardAmount  int64
	RewardDueAt   time.Time
	ForfeitReason string
	RewardedAt    time.Time
}

// FirstPayment is the invitee's first successful payment.
type FirstPayment struct {
	Kind PaymentKind
	// PaymentIntentID may be empty for a subscription when the webhook's
	// Stripe lookup failed; InvoiceID (subscriptions only) recovers it.
	PaymentIntentID string
	InvoiceID       string
	// Credits is what this payment granted the invitee.
	Credits int64
	// PaidAt is when it was paid; zero means "now".
	PaidAt time.Time
}

// Reward is what recording a first payment queues for the referrer.
type Reward struct {
	Status Status // StatusPending or StatusNoReward
	Amount int64
	DueAt  time.Time
}

// CodeRepo stores invite codes: one per user, never changed.
type CodeRepo interface {
	CodeOf(ctx context.Context, userID string) (code string, ok bool, err error)
	OwnerOf(ctx context.Context, code string) (userID string, ok bool, err error)
	// Insert stores code for userID. inserted is false, with no error, when
	// userID already has a code or the code belongs to someone else.
	Insert(ctx context.Context, userID, code string, at time.Time) (inserted bool, err error)
}

// ReferralRepo stores referrals.
type ReferralRepo interface {
	Get(ctx context.Context, inviteeID string) (Referral, bool, error)
	// Insert stores r. inserted is false, with no error, when the invitee
	// already has a referral.
	Insert(ctx context.Context, r Referral) (inserted bool, err error)
	ByReferrer(ctx context.Context, referrerID string) ([]Referral, error)
	// RecordFirstPayment stores p and reward on the invitee's referral
	// unless it already has a first payment; recorded is false then.
	RecordFirstPayment(ctx context.Context, inviteeID string, p FirstPayment, reward Reward) (recorded bool, err error)
	// DueRewards lists due pending referrals and forfeited referrals with a
	// committed ledger key (rewardKeyPrefix + inviteeID) to reconcile.
	DueRewards(ctx context.Context, at time.Time, rewardKeyPrefix string) ([]Referral, error)
	SetPaymentIntent(ctx context.Context, inviteeID, paymentIntentID string) error
	// MarkRewarded settles pending or forfeited referrals after a committed
	// grant, clearing the forfeit reason. Rewarded rows never change.
	MarkRewarded(ctx context.Context, inviteeID string, at time.Time) error
	// MarkForfeited only settles pending referrals.
	MarkForfeited(ctx context.Context, inviteeID, reason string, at time.Time) error
}

// AccountRepo answers what the claim rules need to know about an account.
type AccountRepo interface {
	CreatedAt(ctx context.Context, userID string) (time.Time, error)
	// HasPaid reports whether the user ever bought credits.
	HasPaid(ctx context.Context, userID string) (bool, error)
	// TrialUsedByAnotherAccount reports whether the user's email was granted
	// the sign-up trial by a different account (ADR-062 Decision 3): this
	// is a deleted account signed up again.
	TrialUsedByAnotherAccount(ctx context.Context, userID string) (bool, error)
	// Exists reports whether the user's account is still there: a disabled
	// account exists, a deleted one (ADR-062) does not.
	Exists(ctx context.Context, userID string) (bool, error)
}

// Bonus is the invitee's claim grant.
type Bonus struct {
	Amount int64
	// ExpiresAt is the earliest the trial may now expire.
	ExpiresAt time.Time
	// TrialAmount and TrialTTL issue the ADR-048 trial first when the
	// account never got it.
	TrialAmount int64
	TrialTTL    time.Duration
}

// CreditGranter is the credit ledger.
type CreditGranter interface {
	// RewardGranted reports whether the ledger has processed the reward key.
	RewardGranted(ctx context.Context, key string) (bool, error)
	// GrantInviteeBonus adds the bonus to the invitee's trial pool, once
	// per invitee, and returns the trial's expiry.
	GrantInviteeBonus(ctx context.Context, inviteeID string, b Bonus) (trialExpiresAt time.Time, err error)
	// GrantReferrerReward adds amount to the referrer's top-up pool,
	// idempotent on key. It returns ErrReferrerDeleted, granting nothing,
	// when the referrer's account is gone by the time the grant runs.
	GrantReferrerReward(ctx context.Context, referrerID string, amount int64, key string) error
}

// ErrReferrerDeleted: the referrer deleted their account, so the reward has
// no account to go into and is forfeited (ADR-051 Decision 5).
var ErrReferrerDeleted = errors.New("referral: the referrer's account was deleted")

// ChargeState is what Stripe says happened to a payment after it succeeded.
type ChargeState struct {
	Refunded bool // any amount refunded, partial included
	Disputed bool
}

// PaymentChecker asks Stripe about a payment.
type PaymentChecker interface {
	// InvoicePaymentIntent returns the payment intent that paid invoiceID,
	// "" when none is found.
	InvoicePaymentIntent(ctx context.Context, invoiceID string) (string, error)
	Charge(ctx context.Context, paymentIntentID string) (ChargeState, error)
}

// Clock is the service's time source.
type Clock func() time.Time

// Terms are the configured numbers (ADR-051 Decision 7), with ADR-048's
// trial alongside. 0 switches a grant off.
type Terms struct {
	TrialAmount int64
	TrialTTL    time.Duration

	InviteeBonus               int64
	InviteeTTL                 time.Duration
	ReferrerRewardSubscription int64
	ReferrerRewardTopupPercent int64
	RewardDelay                time.Duration
	ClaimWindow                time.Duration
}

// CreditPolicy supplies the terms. v1 reads config; an admin-editable
// settings table can replace it later without touching callers.
type CreditPolicy interface {
	Terms() Terms
}

// FixedPolicy is a CreditPolicy that never changes: the config values.
type FixedPolicy Terms

func (p FixedPolicy) Terms() Terms { return Terms(p) }

// Observer hears claim and reward outcomes: the Prometheus counters.
type Observer interface {
	ObserveReferralClaim(result string)
	ObserveReferralReward(result string)
}
