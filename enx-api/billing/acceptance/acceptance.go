// Package acceptance decides whether ENX accepts a Stripe subscription for
// its owner, keeps it as history, or rejects it as a subscription conflict
// (ADR-067 §订阅归属与接受关系). It is pure: the caller reads both
// subscriptions' live Stripe status outside any database write transaction,
// then applies the Decision under a conditional write that revalidates the
// observed acceptance pointer, billing revision and row versions, retrying
// with fresh observations when any of them changed.
package acceptance

// Classification is ENX's verdict on a subscription, kept apart from its
// Stripe status.
type Classification string

const (
	Unclassified Classification = ""
	Accepted     Classification = "accepted"
	Conflict     Classification = "conflict"
	Stale        Classification = "stale"
)

// Deletion is the owner's account-deletion coordination gate.
type Deletion int

const (
	NoDeletion Deletion = iota
	DeletionInProgress
	DeletionCompleted
)

// Observation is what the caller saw: the incoming subscription's
// classification and live Stripe status, and the owner's accepted
// subscription (AcceptedID "" when none) with its live Stripe status.
type Observation struct {
	IncomingID             string
	IncomingClassification Classification
	IncomingStatus         string
	AcceptedID             string
	AcceptedStatus         string
	Deletion               Deletion
}

// Outcome is what to do with the incoming subscription.
type Outcome int

const (
	// NeedsAttention: an administrator must investigate; Reason says why.
	NeedsAttention Outcome = iota
	// Accept points the owner's acceptance at the incoming subscription.
	Accept
	// Replay: the incoming subscription is the accepted one; nothing changes.
	Replay
	// Unchanged: it is already a conflict, stale, or formerly accepted
	// history. A conflict is never promoted or reopened.
	Unchanged
	// MarkStale: an unclassified subscription that already ended in Stripe.
	MarkStale
	// MarkConflict: it competes with the live accepted subscription
	// ConflictWith; the first acceptance wins, not purchase or arrival order.
	MarkConflict
	// WaitForDeletion: the owner's deletion is in progress; decide again once
	// it completes or aborts.
	WaitForDeletion
)

// Reasons for MarkConflict and NeedsAttention.
const (
	ReasonCompetesWithAccepted        = "competes_with_accepted"
	ReasonPaymentAfterAccountDeletion = "payment_after_account_deletion"
	ReasonUnrecognizedStatus          = "unrecognized_subscription_status"
)

// Decision is what Decide chose. ConflictWith is the accepted subscription
// at detection, set only for MarkConflict.
type Decision struct {
	Outcome      Outcome
	Reason       string
	ConflictWith string
}

// Billable reports whether Stripe can still charge a subscription in this
// status.
func Billable(status string) bool {
	switch status {
	case "active", "trialing", "past_due", "incomplete", "unpaid":
		return true
	}
	return false
}

// Ended reports whether Stripe has authoritatively ended a subscription in
// this status. A period-end cancellation is still active, not ended.
func Ended(status string) bool {
	return status == "canceled" || status == "incomplete_expired"
}

// Decide applies ADR-067's acceptance rules. A replay of the accepted
// subscription and an already classified subscription change nothing. While
// deletion is in progress nothing is accepted; after it, a payment needs
// attention. An unclassified subscription that already ended is stale. A
// live one is accepted when nothing is accepted or the accepted one has
// ended, and is a conflict while the accepted one is still billable. A status
// outside Stripe's billable and ended sets is never guessed at.
func Decide(o Observation) Decision {
	if o.AcceptedID != "" && o.IncomingID == o.AcceptedID {
		return Decision{Outcome: Replay}
	}
	if o.IncomingClassification != Unclassified {
		return Decision{Outcome: Unchanged}
	}
	switch o.Deletion {
	case DeletionInProgress:
		return Decision{Outcome: WaitForDeletion}
	case DeletionCompleted:
		return Decision{Outcome: NeedsAttention, Reason: ReasonPaymentAfterAccountDeletion}
	}
	switch {
	case Ended(o.IncomingStatus):
		return Decision{Outcome: MarkStale}
	case !Billable(o.IncomingStatus):
		return Decision{Outcome: NeedsAttention, Reason: ReasonUnrecognizedStatus}
	}
	switch {
	case o.AcceptedID == "", Ended(o.AcceptedStatus):
		return Decision{Outcome: Accept}
	case Billable(o.AcceptedStatus):
		return Decision{Outcome: MarkConflict, Reason: ReasonCompetesWithAccepted, ConflictWith: o.AcceptedID}
	}
	return Decision{Outcome: NeedsAttention, Reason: ReasonUnrecognizedStatus}
}
