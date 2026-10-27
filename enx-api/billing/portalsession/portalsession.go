// Package portalsession decides and creates a user's Stripe Customer Portal
// sessions (ADR-067 §正常重新购买与购买阻断, §改档由 Stripe Customer Portal
// 完成): the Portal home behind /billing "Manage subscription", and the
// plan-change deep link behind a /billing tier card. A blocked user's
// sessions all use the restricted configuration with plan switching off, and
// the server refuses a plan change the eligibility rules refuse, so calling
// the API directly bypasses nothing.
//
// Service reads the store, then live Stripe state, outside any database
// transaction, and writes nothing locally. Every lookup it needs must
// succeed: a failure creates no session and is ErrUnavailable, retryable,
// and neither configuration ever stands in for the other.
package portalsession

import (
	"context"
	"errors"
	"fmt"

	"enx-api/billing/acceptance"
	"enx-api/billing/eligibility"
)

var (
	// ErrUnavailable: a store or Stripe lookup, a configuration check or the
	// session creation failed. No session exists; retry later.
	ErrUnavailable = errors.New("billing/portalsession: billing portal unavailable")
	// ErrNoCustomer: the user has no Stripe Customer, so the Portal has
	// nothing to manage.
	ErrNoCustomer = errors.New("billing/portalsession: no Stripe Customer")
	// ErrBlocked: the deletion gate or a subscription conflict blocks plan
	// changes. Returned as *BlockedError.
	ErrBlocked = errors.New("billing/portalsession: plan change blocked")
	// ErrUnknownTier: the requested tier is not one ENX offers.
	ErrUnknownTier = errors.New("billing/portalsession: unknown tier")
	// ErrNotAPlanChange: the tier card offers no plan change: the user has
	// no live accepted subscription (subscribe through Checkout) or is
	// already on that tier.
	ErrNotAPlanChange = errors.New("billing/portalsession: not a plan change")
	// ErrUnknownSubscriptionPrice: the accepted subscription is healthy but
	// its item is not exactly one item on one of ENX's tier Prices, so no
	// plan change can be decided. An administrator must look at it.
	ErrUnknownSubscriptionPrice = errors.New("billing/portalsession: accepted subscription has no single tier Price")
)

// BlockedError is ErrBlocked with the eligibility reason
// (eligibility.ReasonDeletionInProgress or ReasonSubscriptionConflict).
type BlockedError struct {
	Reason string
	// SubscriptionID is the blocking owned conflict's subscription; set only
	// for ReasonSubscriptionConflict.
	SubscriptionID string
}

func (e *BlockedError) Error() string { return ErrBlocked.Error() + ": " + e.Reason }

func (e *BlockedError) Is(target error) bool { return target == ErrBlocked }

// Owner is what ENX stores about a user's billing.
type Owner struct {
	Deletion acceptance.Deletion
	// Owned is every subscription the user owns, whatever its
	// classification, with Live unset.
	Owned []eligibility.Owned
	// AcceptedID is the accepted subscription, "" when none, and
	// AcceptedCustomerID its Stripe Customer.
	AcceptedID         string
	AcceptedCustomerID string
	// CustomerID is the user's normal Stripe Customer, reused when no live
	// accepted subscription selects one; "" when none.
	CustomerID string
}

// Store reads a user's billing.
type Store interface {
	Owner(ctx context.Context, userID string) (Owner, error)
}

// Item is one subscription item and its current Price.
type Item struct {
	ID      string
	PriceID string
}

// Subscription is a subscription's live Stripe state and items.
type Subscription struct {
	eligibility.Live
	Items []Item
	// ItemsComplete is false when Stripe has more items than it returned.
	ItemsComplete bool
}

// PlanChange is a subscription_update_confirm deep link: the existing item
// moves to PriceID.
type PlanChange struct {
	SubscriptionID string
	ItemID         string
	PriceID        string
}

// Session is a Portal session to create under a checked configuration. A
// nil PlanChange opens the Portal home.
type Session struct {
	CustomerID      string
	ConfigurationID string
	ReturnURL       string
	PlanChange      *PlanChange
}

// Stripe reads live Stripe state and creates Portal sessions.
type Stripe interface {
	Subscription(ctx context.Context, subscriptionID string) (Subscription, error)
	// TierPrices maps each tier ENX offers to its Price ID.
	TierPrices(ctx context.Context) (map[string]string, error)
	// PlanChangeConfiguration and RestrictedConfiguration resolve and check
	// a configuration, returning its ID.
	PlanChangeConfiguration(ctx context.Context, tierPrices map[string]string) (string, error)
	RestrictedConfiguration(ctx context.Context) (string, error)
	// CreateSession returns the session's URL.
	CreateSession(ctx context.Context, s Session) (string, error)
}

// Service creates Portal sessions.
type Service struct {
	store     Store
	stripe    Stripe
	returnURL string
}

// New returns a Service whose sessions return the user to returnURL.
func New(store Store, stripe Stripe, returnURL string) *Service {
	return &Service{store: store, stripe: stripe, returnURL: returnURL}
}

// Home creates a Portal home session and returns its URL.
func (s *Service) Home(ctx context.Context, userID string) (string, error) {
	owner, err := s.store.Owner(ctx, userID)
	if err != nil {
		return "", unavailable(err)
	}
	a, err := s.assess(ctx, owner)
	if err != nil {
		return "", err
	}
	return s.home(ctx, a)
}

// PlanChange creates the session a tier card's button opens and returns its
// URL.
func (s *Service) PlanChange(ctx context.Context, userID, tier string) (string, error) {
	owner, err := s.store.Owner(ctx, userID)
	if err != nil {
		return "", unavailable(err)
	}
	tierPrices, err := s.stripe.TierPrices(ctx)
	if err != nil {
		return "", unavailable(err)
	}
	if tierPrices[tier] == "" {
		return "", fmt.Errorf("%w: %q", ErrUnknownTier, tier)
	}
	a, err := s.assess(ctx, owner)
	if err != nil {
		return "", err
	}
	item, itemTier := a.acceptedItem(tierPrices)
	if a.account.Accepted != nil {
		a.account.Accepted.Tier = itemTier
	}

	entry := eligibility.TierEntry(a.account, tier)
	switch entry.Kind {
	case eligibility.EntryBlocked:
		blocked := &BlockedError{Reason: entry.Reason}
		if entry.Reason == eligibility.ReasonSubscriptionConflict {
			blocked.SubscriptionID = a.account.BlockingConflictID
		}
		return "", blocked
	case eligibility.EntryCheckout, eligibility.EntryCurrentTier:
		return "", ErrNotAPlanChange
	case eligibility.EntryPortalHome:
		return s.home(ctx, a)
	}
	if itemTier == "" {
		return "", fmt.Errorf("%w: %s", ErrUnknownSubscriptionPrice, owner.AcceptedID)
	}
	configurationID, err := s.stripe.PlanChangeConfiguration(ctx, tierPrices)
	if err != nil {
		return "", unavailable(err)
	}
	return s.create(ctx, Session{
		CustomerID:      a.customerID(),
		ConfigurationID: configurationID,
		ReturnURL:       s.returnURL,
		PlanChange:      &PlanChange{SubscriptionID: owner.AcceptedID, ItemID: item.ID, PriceID: tierPrices[tier]},
	})
}

// acceptedItem is the accepted subscription's one item and the tier of its
// current Price, the subscription's effective tier. The tier is "" unless
// Stripe returned exactly one item, on one of ENX's tier Prices.
func (a assessment) acceptedItem(tierPrices map[string]string) (Item, string) {
	if len(a.accepted.Items) != 1 || !a.accepted.ItemsComplete {
		return Item{}, ""
	}
	item := a.accepted.Items[0]
	for tier, price := range tierPrices {
		if price == item.PriceID {
			return item, tier
		}
	}
	return item, ""
}

// assessment is the user's account as the eligibility rules see it, with
// the accepted subscription's live state.
type assessment struct {
	owner    Owner
	account  eligibility.Account
	accepted Subscription
}

// assess reads the live Stripe state the eligibility rules need: every
// owned conflict whose stored status is not terminal, then the accepted
// subscription. The deletion gate restricts on its own, so conflicts are
// not read while it is up.
func (s *Service) assess(ctx context.Context, owner Owner) (assessment, error) {
	a := assessment{owner: owner, account: eligibility.Account{Deletion: owner.Deletion}}
	if owner.Deletion == acceptance.NoDeletion {
		owned := make([]eligibility.Owned, len(owner.Owned))
		for i, o := range owner.Owned {
			if o.Conflict != eligibility.NoConflict && eligibility.NeedsLiveLookup(o) {
				if sub, err := s.stripe.Subscription(ctx, o.ID); err == nil {
					o.Live = &sub.Live
				}
			}
			owned[i] = o
		}
		blocking, err := eligibility.BlockingConflict(owned)
		if err != nil {
			return a, unavailable(err)
		}
		a.account.BlockingConflictID = blocking
	}
	if owner.AcceptedID != "" {
		sub, err := s.stripe.Subscription(ctx, owner.AcceptedID)
		if err != nil {
			return a, unavailable(err)
		}
		a.accepted = sub
		a.account.Accepted = &eligibility.Accepted{Live: sub.Live}
	}
	return a, nil
}

// home creates a Portal home session under the configuration the user's
// restriction calls for.
func (s *Service) home(ctx context.Context, a assessment) (string, error) {
	if a.customerID() == "" {
		return "", ErrNoCustomer
	}
	var configurationID string
	var err error
	if eligibility.PortalRestricted(a.account) {
		configurationID, err = s.stripe.RestrictedConfiguration(ctx)
	} else {
		var tierPrices map[string]string
		if tierPrices, err = s.stripe.TierPrices(ctx); err == nil {
			configurationID, err = s.stripe.PlanChangeConfiguration(ctx, tierPrices)
		}
	}
	if err != nil {
		return "", unavailable(err)
	}
	return s.create(ctx, Session{CustomerID: a.customerID(), ConfigurationID: configurationID, ReturnURL: s.returnURL})
}

// customerID is the Customer the Portal opens: a live accepted
// subscription's, else the user's normal one (ADR-067 §一次性充值与 Stripe
// Customer).
func (a assessment) customerID() string {
	if a.account.Accepted != nil && !acceptance.Ended(a.account.Accepted.Live.Status) && a.owner.AcceptedCustomerID != "" {
		return a.owner.AcceptedCustomerID
	}
	return a.owner.CustomerID
}

func (s *Service) create(ctx context.Context, session Session) (string, error) {
	url, err := s.stripe.CreateSession(ctx, session)
	if err != nil {
		return "", unavailable(err)
	}
	return url, nil
}

func unavailable(err error) error {
	return fmt.Errorf("%w: %w", ErrUnavailable, err)
}
