// Package webhookevent holds the rules for durably received Stripe webhook
// events (ADR-067): what receipt reads from a payload, which endpoint an
// event belongs to, how its Event ID is scoped, how the worker handles each
// event type, and the timing of worker retries and dependency waits. It is pure:
// callers bring the configured key, the discovered account, the clock and the
// configured durations.
package webhookevent

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Status is a Stripe webhook event's processing state (ADR-067).
type Status string

const (
	Pending           Status = "pending"
	Processing        Status = "processing"
	WaitingDependency Status = "waiting_dependency"
	Processed         Status = "processed"
	NeedsAttention    Status = "needs_attention"
	Ignored           Status = "ignored"
)

var (
	// ErrUnknownKeyPrefix: the Stripe API key is neither a live nor a test
	// secret or restricted key, so the expected mode is unknown. A
	// configuration error while billing is enabled.
	ErrUnknownKeyPrefix = errors.New("billing/webhookevent: Stripe API key prefix is not sk_live_, rk_live_, sk_test_ or rk_test_")
	// ErrEndpointUnknown: the endpoint's account has not been discovered yet.
	// Receipt answers 503 and stores nothing, relying on Stripe's retry.
	ErrEndpointUnknown = errors.New("billing/webhookevent: endpoint account not discovered yet")
	// ErrWrongAccount and ErrWrongMode: the event is for another account or
	// the other live/test mode. Receipt answers 400 and stores nothing.
	ErrWrongAccount = errors.New("billing/webhookevent: event is for another Stripe account")
	ErrWrongMode    = errors.New("billing/webhookevent: event is for the other live/test mode")
)

// LivemodeForAPIKey is the mode the configured Stripe API key expects:
// sk_live_/rk_live_ are live, sk_test_/rk_test_ are test.
func LivemodeForAPIKey(key string) (bool, error) {
	switch {
	case strings.HasPrefix(key, "sk_live_"), strings.HasPrefix(key, "rk_live_"):
		return true, nil
	case strings.HasPrefix(key, "sk_test_"), strings.HasPrefix(key, "rk_test_"):
		return false, nil
	}
	return false, ErrUnknownKeyPrefix
}

// Endpoint is ENX's one direct-account webhook endpoint: the account found
// with GET /v1/account at billing startup and the mode of the API key.
type Endpoint struct {
	AccountID string
	Livemode  bool
}

// Admit checks a signature-verified event belongs to this endpoint. An
// ordinary direct-account event carries no account and takes the
// endpoint's; a nonempty one must match. Connect events are out of scope.
func (e Endpoint) Admit(eventAccount string, eventLivemode bool) error {
	if e.AccountID == "" {
		return ErrEndpointUnknown
	}
	if eventAccount != "" && eventAccount != e.AccountID {
		return fmt.Errorf("%w: %s", ErrWrongAccount, eventAccount)
	}
	if eventLivemode != e.Livemode {
		return ErrWrongMode
	}
	return nil
}

// Scope identifies one Stripe webhook event: its Event ID is unique only
// within an account and mode.
type Scope struct {
	AccountID string
	Livemode  bool
	EventID   string
}

// Scope is eventID scoped to this endpoint.
func (e Endpoint) Scope(eventID string) Scope {
	return Scope{AccountID: e.AccountID, Livemode: e.Livemode, EventID: eventID}
}

// Backoff is the delay before retrying a transient failure for the given
// attempt (1-based): minDelay doubled per earlier attempt, capped at
// maxDelay. Transient failures retry indefinitely; only the cap bounds them.
func Backoff(attempt int, minDelay, maxDelay time.Duration) time.Duration {
	delay := minDelay
	for i := 1; i < attempt && delay < maxDelay; i++ {
		if delay > maxDelay/2 {
			return maxDelay
		}
		delay *= 2
	}
	return min(delay, maxDelay)
}

// AfterMissingDependency is the state of an event that still lacks its
// checkout, subscription or grant association, given when it first waited
// (zero if never). The clock starts at the first wait and redelivery,
// restarts and retries never reset it; at deadline the event needs
// attention. The returned time is the first wait to persist.
func AfterMissingDependency(firstWaitAt, now time.Time, deadline time.Duration) (Status, time.Time) {
	if firstWaitAt.IsZero() {
		firstWaitAt = now
	}
	if !now.Before(firstWaitAt.Add(deadline)) {
		return NeedsAttention, firstWaitAt
	}
	return WaitingDependency, firstWaitAt
}
