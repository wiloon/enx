package attribution

import "enx-api/billing/acceptance"

// Ownership is what to do with a Customer a completed Checkout reports.
type Ownership int

const (
	// OwnedByAnotherUser: the Customer already belongs to another user. An
	// administrator must investigate; ownership is never reassigned.
	OwnedByAnotherUser Ownership = iota
	// RecordOwnership: record the Customer as the paying user's.
	RecordOwnership
	// AlreadyOwned: the user already owns it; nothing changes.
	AlreadyOwned
	// NoCustomer: the Checkout carried no Customer (a payment-mode session
	// without customer creation); there is nothing to record.
	NoCustomer
)

// ReasonCustomerOwnedByAnotherUser is the attention reason for
// OwnedByAnotherUser.
const ReasonCustomerOwnedByAnotherUser = "customer_owned_by_another_user"

// RecordCustomer decides how a completed top-up or subscription Checkout
// adds Customer ownership for userID. currentOwner is the Customer's
// recorded owner, "" when it has none. A user can own several Customers;
// recording one never changes which Customer SelectCustomer picks while a
// live accepted subscription exists.
func RecordCustomer(currentOwner, customerID, userID string) Ownership {
	switch {
	case customerID == "":
		return NoCustomer
	case currentOwner == "":
		return RecordOwnership
	case currentOwner == userID:
		return AlreadyOwned
	}
	return OwnedByAnotherUser
}

// Accepted is the user's accepted subscription, the zero value when none,
// with its last known Stripe status.
type Accepted struct {
	SubscriptionID string
	CustomerID     string
	Status         string
}

// SelectCustomer picks the Customer the user's Portal session and next
// Checkout use. owned lists the user's Customers in the order they were
// recorded. A live accepted subscription, one Stripe has not ended, uses its
// own Customer, so a later top-up or a competing checkout's Customer cannot
// move it. Otherwise the most recently recorded Customer is reused, as the
// single legacy row did; "" means none, and Checkout creates one.
func SelectCustomer(owned []string, accepted Accepted) string {
	if accepted.SubscriptionID != "" && accepted.CustomerID != "" && !acceptance.Ended(accepted.Status) {
		return accepted.CustomerID
	}
	if len(owned) == 0 {
		return ""
	}
	return owned[len(owned)-1]
}
