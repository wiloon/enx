// Package attribution decides which ENX local user owns a Stripe
// subscription, and which Stripe Customer a user's Portal and Checkout use
// (ADR-067 §用户关联与乱序恢复, §一次性充值与 Stripe Customer). It is pure:
// the caller gathers the trusted evidence and applies the result. Email and
// guesses from a Customer ID are not evidence and have no input here.
package attribution

// Evidence is every trusted source of a subscription's local user ID, ""
// where a source is unavailable.
type Evidence struct {
	// MetadataUserID is the server-set subscription_data.metadata.enx_user_id
	// read from the Subscription, or the invoice's snapshot of it, according
	// to the event's API version.
	MetadataUserID string
	// CheckoutUserID is the client_reference_id of the Checkout Session
	// that created the subscription, from the event itself or a stored
	// Checkout association.
	CheckoutUserID string
	// OwnerUserID is the subscription's already verified owner.
	OwnerUserID string
}

// Outcome is what Attribute concluded.
type Outcome int

const (
	// Contradictory: trusted sources name different users. An administrator
	// must investigate; the stored owner is never overwritten.
	Contradictory Outcome = iota
	// Attributed: UserID owns the subscription.
	Attributed
	// Missing: no trusted source yet. The event waits for its dependency
	// (an invoice can arrive before its checkout); unknown is not a
	// competing subscription.
	Missing
)

// Reasons for Missing and Contradictory.
const (
	ReasonAttributionMissing        = "attribution_missing"
	ReasonContradictoryUserIdentity = "contradictory_user_identity"
)

// Result is what Attribute chose. UserID is set only for Attributed.
type Result struct {
	Outcome Outcome
	UserID  string
	Reason  string
}

// Attribute attributes a subscription to the one user every available
// trusted source names. No source means the attribution is still missing;
// any disagreement, however many sources agree otherwise, is a
// contradiction.
func Attribute(e Evidence) Result {
	var userID string
	for _, id := range []string{e.OwnerUserID, e.MetadataUserID, e.CheckoutUserID} {
		switch {
		case id == "":
		case userID == "":
			userID = id
		case id != userID:
			return Result{Outcome: Contradictory, Reason: ReasonContradictoryUserIdentity}
		}
	}
	if userID == "" {
		return Result{Outcome: Missing, Reason: ReasonAttributionMissing}
	}
	return Result{Outcome: Attributed, UserID: userID}
}
