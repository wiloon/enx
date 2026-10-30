// Package creditperiod decides what a subscription billing effect does to
// the subscription pool, from the recorded provenance of the pool and of
// each grant (ADR-067 §积分周期与退款来源). It is pure: the caller reads the
// pool's provenance, the stored grants and the acceptance pointer under the
// same revision check it writes the Effect with, and always keeps the
// financial record, whatever the Outcome.
//
// Conflict invoices never reach this package: they grant nothing and stay
// investigation context. Top-up grants and their clawbacks keep ADR-049's
// rules in billing/credit.
package creditperiod

import (
	"errors"
	"fmt"

	"enx-api/billing/invoice"
)

// Source is the subscription period a pool or grant belongs to.
type Source struct {
	SubscriptionID string
	Period         invoice.Period
}

// Pool is where today's subscription_balance came from. A zero Source means
// the owner has no subscription pool yet.
type Pool struct {
	Source Source
	// WithoutPeriod: the pool came from a migrated ledger grant that the
	// legacy provenance backfill could not pin to one invoice. Source carries
	// the migrated subscription and credit_accounts.period_end as Period.End;
	// Period.Start is unknown.
	WithoutPeriod bool
}

// Grant is a stored subscription grant (a normal period grant or upgrade
// top-up credits). A zero Source is an old ledger grant the backfill did not
// cover: history and refund audit only.
type Grant struct {
	Source Source
	// WithoutPeriod: the backfill found this migrated grant supplies the pool
	// but Stripe could not pin it to one invoice.
	WithoutPeriod bool
	// Applied is what the grant actually put into the pool.
	Applied int64
}

// Outcome is what to do with the subscription pool.
type Outcome int

const (
	// NeedsAttention: change nothing; an administrator must investigate.
	NeedsAttention Outcome = iota
	// Apply: a normal grant resets the pool to Credits and points its
	// provenance at the grant; upgrade top-up credits add Credits; a
	// clawback takes Credits.
	Apply
	// RecordOnly: keep the financial record with zero pool effect.
	RecordOnly
	// WaitDependency: retry once the missing record exists, until the
	// dependency-wait deadline.
	WaitDependency
)

// Reasons for NeedsAttention and WaitDependency.
const (
	ReasonNormalGrantMissing       = "normal_grant_missing"
	ReasonLegacyGrantWithoutPeriod = "legacy_grant_without_period"
	ReasonUpgradeNotHigher         = "upgrade_not_higher"
)

// Effect is what a billing effect does. Purchased is the grant's bought
// credits, kept on the financial record whatever the Outcome; Credits is
// what moves in the pool, set only for Apply.
type Effect struct {
	Outcome   Outcome
	Reason    string
	Purchased int64
	Credits   int64
}

// ErrGrantOfAnotherSubscription: the denominator grant handed to UpgradeTopUp
// belongs to another subscription.
var ErrGrantOfAnotherSubscription = errors.New("billing/creditperiod: normal grant belongs to another subscription")

// ErrInvalidRefund: the refund handed to Clawback is not a valid cumulative
// refund of its charge.
var ErrInvalidRefund = errors.New("billing/creditperiod: not a valid refund")

// NormalGrant decides a paid normal-period invoice buying credits for grant.
// accepted reports whether grant's subscription is the owner's current
// accepted one. It resets the pool only for the accepted subscription's
// genuinely new period: a later period of the pool's own subscription, or
// the first period of a replacement. Periods are compared only within one
// Subscription ID, so a replacement with another period length still
// initializes the pool once. Same or older periods and historical
// subscriptions are recorded with zero pool effect.
func NormalGrant(pool Pool, grant Source, accepted bool, credits int64) Effect {
	recordOnly := Effect{Outcome: RecordOnly, Purchased: credits}
	if !accepted {
		return recordOnly
	}
	if pool.Source.SubscriptionID == grant.SubscriptionID && grant.Period.End <= pool.Source.Period.End {
		return recordOnly
	}
	return Effect{Outcome: Apply, Purchased: credits, Credits: credits}
}

// Upgrade is a paid subscription_update invoice classified as upgrade top-up
// credits. PeriodGrant is the stored normal grant of SubscriptionID whose
// period ends where Line ends, nil when there is none yet. A migrated pool
// without a period that matches the line is enough to need attention; the
// lookup cannot find its grant.
type Upgrade struct {
	Pool           Pool
	Accepted       bool
	SubscriptionID string
	Line           invoice.Period
	FromCredits    int64
	ToCredits      int64
	PeriodGrant    *Grant
}

// UpgradeTopUp decides an upgrade's top-up credits. They are added only when
// the subscription is accepted and the pool still comes from PeriodGrant's
// period; once the pool has moved on, or for a historical subscription, they
// are recorded with zero pool effect. Without PeriodGrant the invoice waits.
// A target tier that grants no more credits, or a migrated grant Stripe could
// not pin down, needs attention. The error reports a PeriodGrant that does
// not match the line, which the caller's lookup rules out.
func UpgradeTopUp(u Upgrade) (Effect, error) {
	if u.ToCredits <= u.FromCredits {
		return Effect{Outcome: NeedsAttention, Reason: ReasonUpgradeNotHigher}, nil
	}
	if u.Pool.WithoutPeriod && u.Pool.Source.SubscriptionID == u.SubscriptionID && u.Pool.Source.Period.End == u.Line.End {
		return Effect{Outcome: NeedsAttention, Reason: ReasonLegacyGrantWithoutPeriod}, nil
	}
	if u.PeriodGrant == nil {
		return Effect{Outcome: WaitDependency, Reason: ReasonNormalGrantMissing}, nil
	}
	if u.PeriodGrant.WithoutPeriod {
		return Effect{Outcome: NeedsAttention, Reason: ReasonLegacyGrantWithoutPeriod}, nil
	}
	grant := u.PeriodGrant.Source
	if grant.SubscriptionID != u.SubscriptionID {
		return Effect{}, fmt.Errorf("%w: %s, want %s", ErrGrantOfAnotherSubscription, grant.SubscriptionID, u.SubscriptionID)
	}
	purchased, err := invoice.UpgradeTopUpCredits(u.FromCredits, u.ToCredits, u.Line, grant.Period)
	if err != nil {
		return Effect{}, err
	}
	if !u.Accepted || u.Pool.Source != grant {
		return Effect{Outcome: RecordOnly, Purchased: purchased}, nil
	}
	return Effect{Outcome: Apply, Purchased: purchased, Credits: purchased}, nil
}

// Refund is a Stripe refund of a subscription grant's payment. Refunded and
// Captured are the charge's cumulative amount_refunded and amount_captured;
// AlreadyTaken is what earlier clawbacks of the same grant took; Balance is
// today's subscription_balance.
type Refund struct {
	Refunded     int64
	Captured     int64
	AlreadyTaken int64
	Balance      int64
}

// Clawback decides what a refund of grant's payment takes from the
// subscription pool. Only a grant that actually reached the pool, and whose
// subscription and period are the pool's provenance, is clawed back: its
// cumulative proportional share (ADR-049) minus earlier clawbacks, never
// handing credits back and never taking the pool below zero. Any other grant
// records a zero-effect clawback, so a historical or unapplied grant cannot
// debit a replacement. A migrated grant Stripe could not pin down needs
// attention only while a migrated pool without a period may still come from
// it. The error reports an invalid refund.
func Clawback(pool Pool, grant Grant, r Refund) (Effect, error) {
	if r.Captured <= 0 || r.Refunded < 0 || r.Refunded > r.Captured {
		return Effect{}, fmt.Errorf("%w: refunded %d of captured %d", ErrInvalidRefund, r.Refunded, r.Captured)
	}
	if grant.WithoutPeriod && pool.WithoutPeriod {
		return Effect{Outcome: NeedsAttention, Reason: ReasonLegacyGrantWithoutPeriod}, nil
	}
	if grant.Applied <= 0 || grant.Source == (Source{}) || grant.Source != pool.Source {
		return Effect{Outcome: RecordOnly}, nil
	}
	owed := max(grant.Applied*r.Refunded/r.Captured-r.AlreadyTaken, 0)
	return Effect{Outcome: Apply, Credits: min(owed, max(r.Balance, 0))}, nil
}
