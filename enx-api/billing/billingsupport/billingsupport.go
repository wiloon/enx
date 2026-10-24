// Package billingsupport records a user's billing-support request on their
// own subscription conflict (ADR-067 §管理员处理与邮件), behind
// POST /api/billing/support. The first request stores its message and time
// on the subscription row and raises its support alert in the same write; a
// repeated request returns the first one and raises nothing. The discovery
// alert of the conflict is raised elsewhere and does not wait for this.
package billingsupport

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/conflict"
)

var (
	// ErrUnavailable: the store could not read or save the request. Nothing
	// was recorded; retry later.
	ErrUnavailable = errors.New("billing/billingsupport: billing support unavailable")
	// ErrNotFound: Store.Subscription has no row for the Subscription ID.
	ErrNotFound = errors.New("billing/billingsupport: subscription not found")
	// ErrStale: Store.SaveSupport found the row past the version it was
	// read at, and saved nothing.
	ErrStale = errors.New("billing/billingsupport: subscription changed since it was read")
)

// Record is what the request needs of a subscription row.
type Record struct {
	// Version changes on every write to the row.
	Version      int64
	Subscription conflict.Subscription
	// Alert is the row's support alert.
	Alert alert.Alert
}

// Save is a first support request to store on a subscription row with its
// raised support alert.
type Save struct {
	SubscriptionID string
	Version        int64
	Support        conflict.Support
	Alert          alert.Alert
}

// Store reads and writes subscription rows.
type Store interface {
	// Subscription reads a row, or returns ErrNotFound.
	Subscription(ctx context.Context, subscriptionID string) (Record, error)
	// SaveSupport stores the request and its alert in one transaction,
	// only while the row is still at Version; otherwise it returns ErrStale.
	SaveSupport(ctx context.Context, s Save) error
}

// Service records billing-support requests.
type Service struct {
	store Store
	now   func() time.Time
}

// New returns a Service reading the time from now.
func New(store Store, now func() time.Time) *Service {
	return &Service{store: store, now: now}
}

// saveAttempts bounds the read-and-save rounds a request makes while
// concurrent writes keep moving the row.
const saveAttempts = 3

// Request records userID's message on their conflict subscriptionID and
// returns the request that stands: this one if it is the first, else the
// first. The conflict package's errors report a request the rules refuse;
// a subscription ENX has no row for is conflict.ErrNotOwnedConflict.
func (s *Service) Request(ctx context.Context, userID, subscriptionID, message string) (conflict.Support, error) {
	var err error
	for range saveAttempts {
		var support conflict.Support
		var saved bool
		support, saved, err = s.attempt(ctx, userID, subscriptionID, message)
		if saved {
			return support, err
		}
	}
	return conflict.Support{}, unavailable(err)
}

// attempt reads the row and, for a first request, saves it. saved is false
// only when the row moved under the save and a new round should start.
func (s *Service) attempt(ctx context.Context, userID, subscriptionID, message string) (conflict.Support, bool, error) {
	r, err := s.store.Subscription(ctx, subscriptionID)
	if errors.Is(err, ErrNotFound) {
		return conflict.Support{}, true, conflict.ErrNotOwnedConflict
	}
	if err != nil {
		return conflict.Support{}, true, unavailable(err)
	}
	now := s.now()
	support, created, err := conflict.RequestSupport(r.Subscription, userID, message, now)
	if err != nil || !created {
		return support, true, err
	}
	err = s.store.SaveSupport(ctx, Save{
		SubscriptionID: subscriptionID,
		Version:        r.Version,
		Support:        support,
		Alert:          alert.Raise(r.Alert, now),
	})
	switch {
	case errors.Is(err, ErrStale):
		return conflict.Support{}, false, err
	case err != nil:
		return conflict.Support{}, true, unavailable(err)
	}
	return support, true, nil
}

func unavailable(err error) error {
	return fmt.Errorf("%w: %w", ErrUnavailable, err)
}
