// Package checkout assesses Checkout against owned billing records and live
// Stripe state. It performs no local writes.
package checkout

import (
	"context"
	"errors"

	"enx-api/billing/acceptance"
	"enx-api/billing/attribution"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
)

// Subscriptions reads live Stripe state for accepted and conflicting subscriptions.
type Subscriptions interface {
	Subscription(context.Context, string) (portalsession.Subscription, error)
}

// Service assesses subscription eligibility and selects the Customer for both Checkout modes.
type Service struct {
	store  portalsession.Store
	stripe Subscriptions
}

// New injects ownership reads and live Stripe subscription reads.
func New(store portalsession.Store, stripe Subscriptions) *Service {
	return &Service{store: store, stripe: stripe}
}

// ErrRefused means the tier entry does not permit a new subscription.
var ErrRefused = errors.New("checkout: manage the existing subscription in the billing portal")

// Refusal carries the eligibility reason and the blocking owned conflict.
type Refusal struct{ Reason, SubscriptionID string }

func (r *Refusal) Error() string        { return ErrRefused.Error() }
func (r *Refusal) Is(target error) bool { return target == ErrRefused }

// Prepare returns an owned Customer, or empty only after a successful read
// proves none exists. An empty tier requests a top-up, which needs no
// subscription eligibility check. A failed required read permits no session.
func (s *Service) Prepare(ctx context.Context, userID, tier string) (string, error) {
	owner, err := s.store.Owner(ctx, userID)
	if err != nil {
		return "", err
	}
	account := eligibility.Account{Deletion: owner.Deletion}
	if tier != "" {
		if owner.Deletion != acceptance.NoDeletion {
			return "", &Refusal{Reason: eligibility.ReasonDeletionInProgress}
		}
		for i, owned := range owner.Owned {
			if owned.Conflict == eligibility.ConflictResolved && eligibility.NeedsLiveLookup(owned) {
				if sub, err := s.stripe.Subscription(ctx, owned.ID); err == nil {
					owner.Owned[i].Live = &sub.Live
				}
			}
		}
		blocking, err := eligibility.BlockingConflict(owner.Owned)
		if err != nil {
			return "", err
		}
		account.BlockingConflictID = blocking
		if blocking != "" {
			return "", &Refusal{Reason: eligibility.ReasonSubscriptionConflict, SubscriptionID: blocking}
		}
	}
	accepted := attribution.Accepted{SubscriptionID: owner.AcceptedID, CustomerID: owner.AcceptedCustomerID}
	if owner.AcceptedID != "" {
		sub, err := s.stripe.Subscription(ctx, owner.AcceptedID)
		if err != nil {
			return "", err
		}
		accepted.Status = sub.Status
		account.Accepted = &eligibility.Accepted{Live: sub.Live}
	}
	if tier != "" && eligibility.TierEntry(account, tier).Kind != eligibility.EntryCheckout {
		return "", ErrRefused
	}
	return attribution.SelectCustomer([]string{owner.CustomerID}, accepted), nil
}
