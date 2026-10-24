package webhookevent

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrDiscoveryStopped: the retry ticks ended before the endpoint's account
// was found.
var ErrDiscoveryStopped = errors.New("billing/webhookevent: endpoint account discovery stopped")

// Identity is the endpoint as billing startup has discovered it so far: the
// mode comes from the configured API key at once, the account from
// GET /v1/account once a lookup succeeds. Until then its Endpoint admits no
// event, so receipt answers 503 and Stripe retries. Safe for concurrent use.
type Identity struct {
	livemode bool

	mu        sync.RWMutex
	accountID string
}

// NewIdentity returns the identity of the endpoint for apiKey. A key that
// is neither live nor test is a configuration error.
func NewIdentity(apiKey string) (*Identity, error) {
	livemode, err := LivemodeForAPIKey(apiKey)
	if err != nil {
		return nil, err
	}
	return &Identity{livemode: livemode}, nil
}

// Endpoint is the endpoint as discovered so far; its AccountID is empty
// until discovery succeeds.
func (i *Identity) Endpoint() Endpoint {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return Endpoint{AccountID: i.accountID, Livemode: i.livemode}
}

// Discover looks the account up at once and again on every retry tick
// until a lookup succeeds, reporting each failure. It returns the context's
// error if ctx ends first, or ErrDiscoveryStopped if retries is closed.
func (i *Identity) Discover(ctx context.Context, lookup func(context.Context) (string, error), retries <-chan time.Time, report func(error)) error {
	for {
		accountID, err := lookup(ctx)
		if err == nil && accountID != "" {
			i.mu.Lock()
			i.accountID = accountID
			i.mu.Unlock()
			return nil
		}
		if err == nil {
			err = errors.New("billing/webhookevent: discovered account has no ID")
		}
		report(err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case _, ok := <-retries:
			if !ok {
				return ErrDiscoveryStopped
			}
		}
	}
}
