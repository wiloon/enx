package webhookevent

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAnIdentityNeedsAKnownAPIKeyPrefix(t *testing.T) {
	if _, err := NewIdentity("pk_test_123"); !errors.Is(err, ErrUnknownKeyPrefix) {
		t.Errorf("NewIdentity of a publishable key: %v, want ErrUnknownKeyPrefix", err)
	}
}

func TestAnEndpointAdmitsNothingUntilItsAccountIsDiscovered(t *testing.T) {
	id, err := NewIdentity("sk_live_123")
	if err != nil {
		t.Fatalf("NewIdentity: %v", err)
	}

	if err := id.Endpoint().Admit("", true); !errors.Is(err, ErrEndpointUnknown) {
		t.Errorf("Admit before discovery: %v, want ErrEndpointUnknown", err)
	}
	if err := id.Discover(context.Background(), func(context.Context) (string, error) { return "acct_live", nil }, nil, nil); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if got, want := id.Endpoint(), (Endpoint{AccountID: "acct_live", Livemode: true}); got != want {
		t.Errorf("Endpoint after discovery = %+v, want %+v", got, want)
	}
}

// A failed discovery leaves billing unready and is retried on every tick
// until it succeeds.
func TestDiscoveryRetriesOnEveryTickUntilItFindsTheAccount(t *testing.T) {
	id, _ := NewIdentity("rk_test_123")
	ticks := make(chan time.Time)
	var reported []error
	calls := 0
	lookup := func(context.Context) (string, error) {
		calls++
		if calls < 3 {
			return "", errors.New("stripe unreachable")
		}
		return "acct_sandbox", nil
	}
	done := make(chan error)
	go func() {
		done <- id.Discover(context.Background(), lookup, ticks, func(err error) { reported = append(reported, err) })
	}()

	for range 2 {
		select {
		case ticks <- time.Time{}:
		case err := <-done:
			t.Fatalf("Discover returned %v before its retries", err)
		case <-time.After(5 * time.Second):
			t.Fatal("Discover is not waiting for a retry tick")
		}
	}
	if err := <-done; err != nil {
		t.Fatalf("Discover: %v", err)
	}

	if calls != 3 || len(reported) != 2 {
		t.Errorf("looked up %d times and reported %d failures, want 3 and 2", calls, len(reported))
	}
	if got, want := id.Endpoint(), (Endpoint{AccountID: "acct_sandbox", Livemode: false}); got != want {
		t.Errorf("Endpoint = %+v, want %+v", got, want)
	}
}

func TestDiscoveryStopsWhenItsRetriesEnd(t *testing.T) {
	id, _ := NewIdentity("sk_test_123")
	ticks := make(chan time.Time)
	close(ticks)

	err := id.Discover(context.Background(), func(context.Context) (string, error) { return "", nil }, ticks, func(error) {})

	if !errors.Is(err, ErrDiscoveryStopped) {
		t.Errorf("Discover = %v, want ErrDiscoveryStopped", err)
	}
	if err := id.Endpoint().Admit("", false); !errors.Is(err, ErrEndpointUnknown) {
		t.Errorf("Admit after a lookup with no account: %v, want ErrEndpointUnknown", err)
	}
}

func TestDiscoveryStopsWhenItsContextEnds(t *testing.T) {
	id, _ := NewIdentity("sk_test_123")
	ctx, cancel := context.WithCancel(context.Background())
	lookup := func(context.Context) (string, error) { cancel(); return "", errors.New("stripe unreachable") }

	err := id.Discover(ctx, lookup, make(chan time.Time), func(error) {})

	if !errors.Is(err, context.Canceled) {
		t.Errorf("Discover = %v, want context.Canceled", err)
	}
	if err := id.Endpoint().Admit("", false); !errors.Is(err, ErrEndpointUnknown) {
		t.Errorf("Admit after a failed discovery: %v, want ErrEndpointUnknown", err)
	}
}
