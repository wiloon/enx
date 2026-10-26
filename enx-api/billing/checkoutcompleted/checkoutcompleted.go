// Package checkoutcompleted decides a durably received
// checkout.session.completed event (ADR-067). A completed Checkout is
// trusted evidence of who paid: its client_reference_id is the ENX local
// user. It records that user's Stripe Customer ownership
// (§一次性充值与 Stripe Customer), records the Checkout association of a
// subscription so the subscription's waiting events can be attributed
// (§用户关联与乱序恢复), and grants a top-up. It never grants subscription
// credits and never accepts a subscription: invoice.paid does both.
//
// Handler reads the store outside any database transaction and writes
// nothing: the local changes go out as Effects, which the worker's task
// store commits with the task's next state under its claim, after
// revalidating what Effects.Observed says was read.
package checkoutcompleted

import (
	"context"
	"errors"

	"enx-api/billing/acceptance"
	"enx-api/billing/attribution"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
)

// Reasons this package adds to the ones of the rules it applies.
const (
	// ReasonMalformedCheckout: the payload of a supported version is not a
	// Checkout Session ENX can read, or a subscription Checkout names no
	// subscription or no Customer.
	ReasonMalformedCheckout = "malformed_checkout_session"
	// ReasonCheckoutWithoutUser: the session has no client_reference_id, so
	// nothing trusted says who paid.
	ReasonCheckoutWithoutUser = "checkout_without_user"
	// ReasonUnrecognizedCheckout: the session is neither an ENX top-up nor a
	// subscription Checkout.
	ReasonUnrecognizedCheckout = "unrecognized_checkout"
	// ReasonTopUpCreditsUnset: the top-up's tier has no credits configured,
	// or the session names no tier.
	ReasonTopUpCreditsUnset = "topup_credits_not_configured"
	// ReasonTopUpPaymentNotSettled: the top-up has no settled payment.
	ReasonTopUpPaymentNotSettled = "topup_payment_not_settled"
	// ReasonDeletionInProgress: the payer's account deletion is in progress;
	// decide again once it completes or aborts.
	ReasonDeletionInProgress = "deletion_in_progress"
)

// Subscription is ENX's record of a Stripe subscription. Known is false when
// ENX has no row for it yet.
type Subscription struct {
	Known bool
	// OwnerUserID is the already verified owner, "" until attribution.
	OwnerUserID string
	// CheckoutUserID is the client_reference_id of the Checkout association
	// already stored for it, "" when there is none.
	CheckoutUserID string
	// Version changes on every write to the row.
	Version int64
}

// Owner is the billing state of the paying user.
type Owner struct {
	// Revision is the user's billing revision; every acceptance-relevant
	// write changes it, the deletion gate's included.
	Revision int64
	Deletion acceptance.Deletion
}

// Store reads ENX's billing records. None of the reads needs a lock: Save
// revalidates Effects.Observed before it applies anything.
type Store interface {
	// Payload is the event's original payload.
	Payload(ctx context.Context, scope webhookevent.Scope) ([]byte, error)
	// TopUpRecorded reports whether the top-up of the Checkout Session is
	// already granted, from this event or another one.
	TopUpRecorded(ctx context.Context, checkoutSessionID string) (bool, error)
	// CustomerOwner is the recorded owner of the Stripe Customer, "" when it
	// has none.
	CustomerOwner(ctx context.Context, customerID string) (string, error)
	Subscription(ctx context.Context, subscriptionID string) (Subscription, error)
	Owner(ctx context.Context, userID string) (Owner, error)
}

// Observed is what a decision read. Save applies the Effects only while the
// payer's billing revision, the Customer's recorded owner and the
// subscription row (for a subscription Checkout) are still these; otherwise
// it changes nothing and the worker retries.
type Observed struct {
	UserID              string
	Revision            int64
	CustomerID          string
	CustomerOwner       string
	SubscriptionID      string
	SubscriptionKnown   bool
	SubscriptionVersion int64
}

// CustomerOwnership records CustomerID as UserID's. It never changes which
// Customer an existing live accepted subscription uses (attribution
// SelectCustomer), and it is retained after the user's account deletion.
type CustomerOwnership struct {
	UserID     string
	CustomerID string
}

// CheckoutAssociation records that UserID's Checkout created the
// subscription, creating its row with no owner and no classification if ENX
// had none. Save wakes the subscription's waiting events in the same
// transaction (webhookevent.Wake); invoice.paid attributes and accepts it.
type CheckoutAssociation struct {
	CheckoutSessionID string
	SubscriptionID    string
	UserID            string
	CustomerID        string
}

// TopUp adds Credits to UserID's top-up pool, at most once per Checkout
// Session whatever the Event ID. PaymentIntentID ("" when nothing was
// charged) lets a later refund find the grant (ADR-049).
type TopUp struct {
	CheckoutSessionID string
	PaymentIntentID   string
	UserID            string
	Tier              string
	Credits           int64
}

// Effects are the local changes a decided Checkout commits with its task.
type Effects struct {
	Observed    Observed
	Customer    *CustomerOwnership
	Association *CheckoutAssociation
	TopUp       *TopUp
	// FirstPayment goes to the referral domain (ADR-051) in the same
	// transaction; it decides whether this payment is the first.
	FirstPayment *referral.FirstPayment
}

// Handler decides checkout.session.completed events.
type Handler struct {
	store        Store
	topUpCredits map[string]int64
}

// NewHandler returns a handler. topUpCredits is each top-up tier's credits.
func NewHandler(store Store, topUpCredits map[string]int64) *Handler {
	return &Handler{store: store, topUpCredits: topUpCredits}
}

// Handle decides one checkout.session.completed event. A session ENX cannot
// read, or one with no client_reference_id, needs attention. A top-up
// another Event ID already granted changes nothing. A Customer that belongs
// to another user, or a subscription another trusted source attributes to
// another user, needs attention with nothing changed. While the payer's
// deletion is in progress the event waits; after it, the payment needs
// attention, retaining only its Customer ownership and Checkout
// association. Otherwise the Customer ownership, the subscription's
// Checkout association and the top-up go out as Effects.
func (h *Handler) Handle(ctx context.Context, s webhookevent.StoredTask) webhookevent.Result {
	payload, err := h.store.Payload(ctx, s.Scope)
	if err != nil {
		return transient(err)
	}
	cs, err := DecodeEvent(payload)
	switch {
	case errors.Is(err, ErrUnsupportedAPIVersion):
		return unrecoverable(webhookevent.ReasonUnsupportedAPIVersion, nil)
	case err != nil:
		return unrecoverable(ReasonMalformedCheckout, nil)
	}
	if cs.ClientReferenceID == "" {
		return unrecoverable(ReasonCheckoutWithoutUser, nil)
	}
	userID := cs.ClientReferenceID

	var credits int64
	switch {
	case cs.TopUp():
		if credits = h.topUpCredits[cs.Metadata["tier"]]; credits <= 0 {
			return unrecoverable(ReasonTopUpCreditsUnset, nil)
		}
		if cs.PaymentStatus != "paid" && cs.PaymentStatus != "no_payment_required" {
			return unrecoverable(ReasonTopUpPaymentNotSettled, nil)
		}
		recorded, err := h.store.TopUpRecorded(ctx, cs.ID)
		if err != nil {
			return transient(err)
		}
		if recorded {
			return webhookevent.Result{Step: webhookevent.Handled}
		}
	case cs.Mode == "subscription":
		if cs.SubscriptionID == "" || cs.CustomerID == "" {
			return unrecoverable(ReasonMalformedCheckout, nil)
		}
	default:
		return unrecoverable(ReasonUnrecognizedCheckout, nil)
	}

	owner, err := h.store.Owner(ctx, userID)
	if err != nil {
		return transient(err)
	}
	e := Effects{Observed: Observed{UserID: userID, Revision: owner.Revision, CustomerID: cs.CustomerID}}
	if cs.CustomerID != "" {
		if e.Observed.CustomerOwner, err = h.store.CustomerOwner(ctx, cs.CustomerID); err != nil {
			return transient(err)
		}
	}
	switch attribution.RecordCustomer(e.Observed.CustomerOwner, cs.CustomerID, userID) {
	case attribution.OwnedByAnotherUser:
		return unrecoverable(attribution.ReasonCustomerOwnedByAnotherUser, nil)
	case attribution.RecordOwnership:
		e.Customer = &CustomerOwnership{UserID: userID, CustomerID: cs.CustomerID}
	}

	if !cs.TopUp() {
		sub, err := h.store.Subscription(ctx, cs.SubscriptionID)
		if err != nil {
			return transient(err)
		}
		e.Observed.SubscriptionID = cs.SubscriptionID
		e.Observed.SubscriptionKnown, e.Observed.SubscriptionVersion = sub.Known, sub.Version
		owned := attribution.Attribute(attribution.Evidence{CheckoutUserID: userID, OwnerUserID: sub.OwnerUserID})
		if owned.Outcome == attribution.Contradictory || (sub.CheckoutUserID != "" && sub.CheckoutUserID != userID) {
			return unrecoverable(attribution.ReasonContradictoryUserIdentity, nil)
		}
		if sub.CheckoutUserID == "" {
			e.Association = &CheckoutAssociation{
				CheckoutSessionID: cs.ID, SubscriptionID: cs.SubscriptionID, UserID: userID, CustomerID: cs.CustomerID,
			}
		}
	}

	switch owner.Deletion {
	case acceptance.DeletionInProgress:
		return webhookevent.Result{Step: webhookevent.MissingDependency, Reason: ReasonDeletionInProgress}
	case acceptance.DeletionCompleted:
		return unrecoverable(acceptance.ReasonPaymentAfterAccountDeletion, e)
	}

	if cs.TopUp() {
		e.TopUp = &TopUp{
			CheckoutSessionID: cs.ID, PaymentIntentID: cs.PaymentIntentID, UserID: userID,
			Tier: cs.Metadata["tier"], Credits: credits,
		}
		// No PaymentIntent means nothing was charged (a 100% discount).
		if cs.PaymentIntentID != "" {
			e.FirstPayment = &referral.FirstPayment{
				Kind: referral.KindTopup, PaymentIntentID: cs.PaymentIntentID, Credits: credits, PaidAt: cs.EventCreated,
			}
		}
	}
	return webhookevent.Result{Step: webhookevent.Handled, Effects: e}
}

func transient(err error) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Transient, Reason: err.Error()}
}

// unrecoverable needs attention, committing effects (nil for none) with it.
func unrecoverable(reason string, effects any) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: reason, Effects: effects}
}
