// Package eligibility decides what an ENX user may do with billing right
// now: delete their account (ADR-067 §注销与财务留存), and which entry a
// /billing tier card or a Portal session gets (§正常重新购买与购买阻断,
// §改档由 Stripe Customer Portal 完成). It is pure: the caller reads the
// owned subscriptions, conflict resolutions and the deletion gate under the
// revision check it acts under, and the live Stripe state outside any
// database write transaction.
package eligibility

import (
	"errors"

	"enx-api/billing/acceptance"
)

// ErrLiveStateUnknown: a decision needs a subscription's live Stripe state
// and it could not be read or interpreted. Fail closed with a retryable error.
var ErrLiveStateUnknown = errors.New("eligibility: live Stripe state unknown")

// Live is a subscription's live Stripe state.
type Live struct {
	Status            string
	CancelAtPeriodEnd bool
	// CancelAt is Stripe's cancel_at (Unix seconds, 0 when unset). In
	// flexible billing mode a Portal cancellation sets only this (#337).
	CancelAt int64
	// CurrentPeriodEnd is required to prove that CancelAt stops renewal in
	// this period. Read it from the subscription item, not the subscription.
	CurrentPeriodEnd int64
	// PendingUpdate: an upgrade waits for payment (pending_update).
	PendingUpdate bool
	// HasSchedule: a Subscription Schedule is attached, such as a Portal
	// period-end downgrade.
	HasSchedule bool
}

// CancelScheduled reports whether the subscription is set to end at or
// before the end of its current period. With only CancelAt and no period
// end, cancellation timing is unproven and this returns false.
func (l Live) CancelScheduled() bool {
	return l.CancelAtPeriodEnd || (l.CancelAt != 0 && l.CancelAt <= l.CurrentPeriodEnd)
}

// Renewing reports whether Stripe will bill the subscription again. A status
// outside Stripe's ended set counts as renewing unless a cancellation is
// scheduled for this period.
func (l Live) Renewing() bool {
	return !acceptance.Ended(l.Status) && !l.CancelScheduled()
}

// Conflict is a subscription conflict's resolution.
type Conflict int

const (
	NoConflict Conflict = iota
	ConflictOpen
	ConflictResolved
)

// Owned is one subscription the user owns, whatever its classification.
type Owned struct {
	ID       string
	Conflict Conflict
	// StoredStatus is the local Stripe status snapshot.
	StoredStatus string
	// Live is the live Stripe state; nil when it was not read or the lookup
	// failed (an unexplained resource_missing included).
	Live *Live
}

// NeedsLiveLookup reports whether the deletion check needs the
// subscription's live Stripe state. Only a stored terminal status is
// authoritative on its own: Stripe never revives a canceled or expired
// subscription. Every other status, unpaid, incomplete and unknown ones
// included, is asked.
func NeedsLiveLookup(o Owned) bool {
	return !acceptance.Ended(o.StoredStatus)
}

// DeletionVerdict is whether the user may delete their account.
type DeletionVerdict int

const (
	DeletionAllowed DeletionVerdict = iota
	// DeletionBlockedOpenConflict: an owned conflict is still open, even if
	// Stripe has since ended it; the user must contact an administrator.
	DeletionBlockedOpenConflict
	// DeletionBlockedRenewing: an owned subscription will renew; it must be
	// canceled first. A resolved conflict is no exception.
	DeletionBlockedRenewing
	// DeletionBlockedLookup: an owned subscription's live state is unknown;
	// retry rather than guess it ended.
	DeletionBlockedLookup
)

// Deletion applies ADR-067's deletion check over every owned subscription.
// An open conflict comes first, then a subscription known to renew, then
// one whose live state could not be read.
func Deletion(owned []Owned) DeletionVerdict {
	renewing, unknown := false, false
	for _, o := range owned {
		if o.Conflict == ConflictOpen {
			return DeletionBlockedOpenConflict
		}
		switch {
		case o.Live != nil:
			renewing = renewing || o.Live.Renewing()
		case NeedsLiveLookup(o):
			unknown = true
		}
	}
	switch {
	case renewing:
		return DeletionBlockedRenewing
	case unknown:
		return DeletionBlockedLookup
	}
	return DeletionAllowed
}

// BlockingConflict returns the ID of the owned conflict that blocks new
// Checkout and plan changes, "" when none does. A blocker is one still open,
// even after Stripe ended it, or one resolved but still billable in Stripe;
// a resolution note proves nothing about billing. The smallest blocking ID
// wins, whatever the order of owned. A resolved conflict whose live state is
// unread or outside the recognized billable and ended sets is no candidate:
// it is ErrLiveStateUnknown, unless another conflict already blocks.
func BlockingConflict(owned []Owned) (string, error) {
	blocking, unknown := "", false
	for _, o := range owned {
		isBlocker := false
		switch {
		case o.Conflict == NoConflict:
		case o.Conflict == ConflictOpen:
			isBlocker = true
		case o.Live != nil:
			isBlocker = acceptance.Billable(o.Live.Status)
			unknown = unknown || (!isBlocker && !acceptance.Ended(o.Live.Status))
		case NeedsLiveLookup(o):
			unknown = true
		}
		if isBlocker && (blocking == "" || o.ID < blocking) {
			blocking = o.ID
		}
	}
	if blocking == "" && unknown {
		return "", ErrLiveStateUnknown
	}
	return blocking, nil
}

// Account is what the entry rules need to know about the user.
type Account struct {
	Deletion acceptance.Deletion
	// BlockingConflictID is BlockingConflict's answer: the blocking owned
	// subscription, "" when none blocks.
	BlockingConflictID string
	// Accepted is the accepted subscription; nil when there is none. Its
	// Live state must have been read; a failed lookup is a retryable error
	// before any entry is decided.
	Accepted *Accepted
}

// Accepted is the accepted subscription: the tier of its item's current
// Price and its live Stripe state.
type Accepted struct {
	Tier string
	Live Live
}

// EntryKind is what a /billing tier card offers.
type EntryKind int

const (
	// EntryBlocked: the server refuses Checkout and plan changes (409);
	// Reason says why, and the page links to billing support.
	EntryBlocked EntryKind = iota
	// EntryCheckout: a new subscription through Checkout.
	EntryCheckout
	// EntryPlanChange: a Portal subscription_update_confirm session for the
	// accepted subscription's item and the tier's Price.
	EntryPlanChange
	// EntryPortalHome: the Portal home, where Stripe handles a pending
	// update, schedule, cancellation or payment recovery.
	EntryPortalHome
	// EntryCurrentTier: the user is on this tier; no button.
	EntryCurrentTier
)

// Reasons for EntryBlocked. ReasonDeletionInProgress covers every active
// deletion gate, including the retained gate after deletion completes.
const (
	ReasonDeletionInProgress   = "deletion_in_progress"
	ReasonSubscriptionConflict = "subscription_conflict"
)

// Entry is what TierEntry chose.
type Entry struct {
	Kind   EntryKind
	Reason string
}

// TierEntry decides what the card for tier offers, and what the server
// accepts when Checkout or the plan-change endpoint is called directly. The
// deletion gate and a blocking conflict block both. With no accepted
// subscription, or one Stripe has ended, any tier is bought through
// Checkout. Only a healthy (active) subscriber changes plan, and only when
// Stripe holds no change of its own; every other accepted subscription goes
// to the Portal home and never gets a second Checkout. The caller must
// validate that tier is offered; this rule does not validate tier Prices.
// An empty accepted status is ErrLiveStateUnknown, never a Portal entry.
func TierEntry(a Account, tier string) (Entry, error) {
	if a.Accepted != nil && a.Accepted.Live.Status == "" {
		return Entry{}, ErrLiveStateUnknown
	}
	switch {
	case a.Deletion != acceptance.NoDeletion:
		return Entry{Kind: EntryBlocked, Reason: ReasonDeletionInProgress}, nil
	case a.BlockingConflictID != "":
		return Entry{Kind: EntryBlocked, Reason: ReasonSubscriptionConflict}, nil
	case a.Accepted == nil, acceptance.Ended(a.Accepted.Live.Status):
		return Entry{Kind: EntryCheckout}, nil
	}
	live := a.Accepted.Live
	switch {
	case !healthy(live.Status):
		return Entry{Kind: EntryPortalHome}, nil
	case a.Accepted.Tier == tier:
		return Entry{Kind: EntryCurrentTier}, nil
	case live.PendingUpdate, live.HasSchedule, live.CancelScheduled():
		return Entry{Kind: EntryPortalHome}, nil
	}
	return Entry{Kind: EntryPlanChange}, nil
}

// PortalRestricted reports whether the user's Portal sessions, the Portal
// home included, must use the restricted configuration with plan switching
// off: while the deletion gate is up, a conflict blocks, or the accepted
// subscription is neither healthy nor ended. An empty accepted status is
// ErrLiveStateUnknown, never permission to create even a restricted session.
func PortalRestricted(a Account) (bool, error) {
	if a.Accepted != nil && a.Accepted.Live.Status == "" {
		return false, ErrLiveStateUnknown
	}
	switch {
	case a.Deletion != acceptance.NoDeletion, a.BlockingConflictID != "":
		return true, nil
	case a.Accepted == nil:
		return false, nil
	}
	status := a.Accepted.Live.Status
	return !healthy(status) && !acceptance.Ended(status), nil
}

// healthy follows ADR-067: only an active subscription may change plan.
// Trialing is not healthy; Checkout does not offer a trial.
func healthy(status string) bool {
	return status == "active"
}
