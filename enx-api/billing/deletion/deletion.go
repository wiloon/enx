// Package deletion runs ADR-067's account deletion check (§注销与财务留存,
// ADR-062 Decision 2) over the Subscription-ID-keyed schema: read every owned
// subscription, ask Stripe for the live state of each one that needs it,
// outside any database transaction, and apply eligibility.Deletion.
//
// The check reads once and decides. It is only final once the caller has
// raised the durable deletion barrier: after it no new acceptance can arrive,
// a stored terminal status cannot revive and every other row is looked up
// live. Called before the barrier, its answer can be stale.
package deletion

import (
	"context"
	"fmt"

	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
)

// Store reads what ENX stores about a user's subscriptions.
type Store interface {
	// OwnedSubscriptions is every subscription the user owns, whatever its
	// classification, with Live unset.
	OwnedSubscriptions(ctx context.Context, userID string) ([]eligibility.Owned, error)
}

// Stripe reads a subscription's live state. Any error, resource_missing
// included, means the state is unknown.
type Stripe interface {
	Subscription(ctx context.Context, subscriptionID string) (snapshot.Live, error)
}

// Service decides whether a user may delete their account.
type Service struct {
	store  Store
	stripe Stripe
}

// New returns a Service over store and stripe.
func New(store Store, stripe Stripe) *Service {
	return &Service{store: store, stripe: stripe}
}

// Check returns the deletion verdict for userID. A store failure is an error,
// not a verdict. A failed Stripe lookup leaves the live state unknown, which
// blocks the deletion rather than counting as ended.
func (s *Service) Check(ctx context.Context, userID string) (eligibility.DeletionVerdict, error) {
	owned, err := s.store.OwnedSubscriptions(ctx, userID)
	if err != nil {
		return eligibility.DeletionBlockedLookup, fmt.Errorf("billing/deletion: read owned subscriptions of %s: %w", userID, err)
	}
	for i, o := range owned {
		if !eligibility.NeedsLiveLookup(o) {
			continue
		}
		if sub, err := s.stripe.Subscription(ctx, o.ID); err == nil {
			owned[i].Live = &sub.Live
		}
	}
	return eligibility.Deletion(owned), nil
}
