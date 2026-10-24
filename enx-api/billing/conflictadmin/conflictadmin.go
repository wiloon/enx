// Package conflictadmin is the administrator's view of subscription
// conflicts (ADR-067 §管理员处理与邮件), behind
// /api/admin/subscription-conflicts: list them, read one with its webhook
// events and deliveries, and record a resolution. A conflict is a
// subscription row ENX classified as competing with the user's accepted
// subscription; the Stripe Subscription ID identifies it.
//
// Resolving records that an administrator investigated. It writes only the
// resolution: the row's alerts, ownership and accepted pointer stay as they
// are, so a pending alert is still sent. Nothing here reopens, promotes,
// cancels or refunds a conflict.
package conflictadmin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/billing/conflict"
	"enx-api/billing/webhookevent"
)

var (
	// ErrUnavailable: the store could not read or save. Nothing was
	// recorded; retry later.
	ErrUnavailable = errors.New("billing/conflictadmin: subscription conflicts unavailable")
	// ErrNotFound: ENX has no subscription row with the ID, or the row is
	// not a conflict.
	ErrNotFound = errors.New("billing/conflictadmin: no subscription conflict with that ID")
	// ErrStale: Store.SaveResolution found the row past the version it was
	// read at, and saved nothing.
	ErrStale = errors.New("billing/conflictadmin: subscription changed since it was read")
)

// Conflict is a subscription conflict as an administrator inspects it.
type Conflict struct {
	SubscriptionID string
	// AcceptedSubscriptionID is the owner's accepted subscription the
	// conflict was classified against.
	AcceptedSubscriptionID string
	OwnerID                string
	CustomerID             string
	// StripeStatus is the last Stripe status ENX stored for the
	// subscription; it can lag Stripe.
	StripeStatus string
	Reason       string
	DiscoveredAt time.Time
	Resolution   conflict.Resolution
	// Support is the owner's first billing-support request, if any.
	Support conflict.Support
}

// Delivery is one verified HTTP delivery of a webhook event.
type Delivery struct {
	ID         string
	ReceivedAt time.Time
}

// Event is a webhook event that references the conflict's subscription,
// with its processing state and every delivery of it.
type Event struct {
	EventID    string
	Type       string
	Status     webhookevent.Status
	Attempts   int
	LastError  string
	Deliveries []Delivery
}

// Detail is one conflict with its event context.
type Detail struct {
	Conflict Conflict
	Events   []Event
}

// Record is a conflict row as read for a resolution.
type Record struct {
	// Version changes on every write to the row.
	Version  int64
	Conflict Conflict
}

// ResolutionSave is a first resolution to store on a conflict row.
type ResolutionSave struct {
	SubscriptionID string
	Version        int64
	Resolution     conflict.Resolution
}

// Store reads subscription conflicts and writes their resolution.
type Store interface {
	// ListConflicts reads one page of conflicts, newest discovery first.
	ListConflicts(ctx context.Context, q conflict.ListQuery) ([]Conflict, error)
	// Conflict reads one conflict row, or returns ErrNotFound.
	Conflict(ctx context.Context, subscriptionID string) (Record, error)
	// Events reads the webhook events that reference the subscription,
	// each with all its deliveries.
	Events(ctx context.Context, subscriptionID string) ([]Event, error)
	// SaveResolution stores only the resolution, while the row is still at
	// Version; otherwise it returns ErrStale.
	SaveResolution(ctx context.Context, s ResolutionSave) error
}

// Service serves the administrator's conflict API.
type Service struct {
	store Store
	now   func() time.Time
}

// New returns a Service reading the time from now.
func New(store Store, now func() time.Time) *Service {
	return &Service{store: store, now: now}
}

// List returns one page of conflicts. status is "", open or resolved; an
// unknown one is conflict.ErrInvalidStatus. The page is bounded by
// conflict.ParseListQuery.
func (s *Service) List(ctx context.Context, status string, limit, offset int) ([]Conflict, error) {
	q, err := conflict.ParseListQuery(status, limit, offset)
	if err != nil {
		return nil, err
	}
	conflicts, err := s.store.ListConflicts(ctx, q)
	if err != nil {
		return nil, unavailable(err)
	}
	return conflicts, nil
}

// Detail returns the conflict subscriptionID with its event context.
func (s *Service) Detail(ctx context.Context, subscriptionID string) (Detail, error) {
	r, err := s.read(ctx, subscriptionID)
	if err != nil {
		return Detail{}, err
	}
	events, err := s.store.Events(ctx, subscriptionID)
	if err != nil {
		return Detail{}, unavailable(err)
	}
	return Detail{Conflict: r.Conflict, Events: events}, nil
}

// saveAttempts bounds the read-and-save rounds a resolution makes while
// concurrent writes keep moving the row.
const saveAttempts = 3

// Resolve records operatorID's resolution of the conflict subscriptionID
// and returns the resolution that stands. The conflict package's errors
// report a request the rules refuse; a resolution that lost a race to
// another is judged against the one that committed.
func (s *Service) Resolve(ctx context.Context, operatorID, subscriptionID string, req conflict.ResolveRequest) (conflict.Resolution, error) {
	var err error
	for range saveAttempts {
		var res conflict.Resolution
		var done bool
		res, done, err = s.attemptResolve(ctx, operatorID, subscriptionID, req)
		if done {
			return res, err
		}
	}
	return conflict.Resolution{}, unavailable(err)
}

// attemptResolve reads the row and saves a first resolution. done is false
// only when the row moved under the save and a new round should start.
func (s *Service) attemptResolve(ctx context.Context, operatorID, subscriptionID string, req conflict.ResolveRequest) (conflict.Resolution, bool, error) {
	r, err := s.read(ctx, subscriptionID)
	if err != nil {
		return conflict.Resolution{}, true, err
	}
	res, changed, err := conflict.Resolve(r.Conflict.Resolution, req, operatorID, s.now())
	if err != nil || !changed {
		return res, true, err
	}
	err = s.store.SaveResolution(ctx, ResolutionSave{SubscriptionID: subscriptionID, Version: r.Version, Resolution: res})
	switch {
	case errors.Is(err, ErrStale):
		return conflict.Resolution{}, false, err
	case err != nil:
		return conflict.Resolution{}, true, unavailable(err)
	}
	return res, true, nil
}

func (s *Service) read(ctx context.Context, subscriptionID string) (Record, error) {
	r, err := s.store.Conflict(ctx, subscriptionID)
	if errors.Is(err, ErrNotFound) {
		return Record{}, err
	}
	if err != nil {
		return Record{}, unavailable(err)
	}
	return r, nil
}

func unavailable(err error) error {
	return fmt.Errorf("%w: %w", ErrUnavailable, err)
}
