package main

import (
	"testing"
	"time"
)

// TestNewServerWriteTimeoutExceedsProviderTimeout is the regression test for a
// production bug: WriteTimeout was a hard-coded 30s while the AI provider was
// allowed 60s per call. Go's WriteTimeout covers handler execution, so the
// server killed the connection at 30s while the handler ran on -- and because
// /translate/sentence and /rephrase settle tokens after the provider returns
// (ADR-012/ADR-014), the user was charged for a response they never received.
//
// The assertion is deliberately "strictly greater", not "equal to some
// number": the invariant is the relationship between the two values, not any
// particular duration.
func TestNewServerWriteTimeoutExceedsProviderTimeout(t *testing.T) {
	const provider = 60 * time.Second // the default
	srv := newServer(":0", nil, provider)
	if srv.WriteTimeout <= provider {
		t.Fatalf("WriteTimeout (%v) must be strictly greater than the provider request timeout (%v): "+
			"the server would abort billed AI requests mid-flight", srv.WriteTimeout, provider)
	}
}

// TestNewServerWriteTimeoutTracksConfiguredProviderTimeout checks the two
// values cannot drift apart again when the provider timeout is raised via
// SENTENCE_TRANSLATE_REQUEST_TIMEOUT, and that the floor keeps a tiny
// configured timeout from shrinking the server's own budget.
func TestNewServerWriteTimeoutTracksConfiguredProviderTimeout(t *testing.T) {
	for _, tc := range []struct {
		name     string
		provider time.Duration
		want     time.Duration
	}{
		{name: "default", provider: 60 * time.Second, want: 60*time.Second + writeTimeoutHeadroom},
		{name: "raised", provider: 180 * time.Second, want: 180*time.Second + writeTimeoutHeadroom},
		{name: "tiny value hits the floor", provider: time.Second, want: minWriteTimeout},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			srv := newServer(":0", nil, tc.provider)
			if srv.WriteTimeout != tc.want {
				t.Errorf("provider timeout %s: WriteTimeout = %v, want %v", tc.provider, srv.WriteTimeout, tc.want)
			}
			if srv.WriteTimeout <= tc.provider {
				t.Errorf("provider timeout %s: WriteTimeout (%v) must exceed provider timeout (%v)",
					tc.provider, srv.WriteTimeout, tc.provider)
			}
		})
	}
}

// TestNewServerLeavesOtherTimeoutsAlone pins the timeouts the fix was not
// meant to touch, so a future change to the WriteTimeout derivation cannot
// quietly take them with it.
func TestNewServerLeavesOtherTimeoutsAlone(t *testing.T) {
	srv := newServer(":0", nil, 60*time.Second)
	if want := 10 * time.Second; srv.ReadHeaderTimeout != want {
		t.Errorf("ReadHeaderTimeout = %v, want %v", srv.ReadHeaderTimeout, want)
	}
	if want := 120 * time.Second; srv.IdleTimeout != want {
		t.Errorf("IdleTimeout = %v, want %v", srv.IdleTimeout, want)
	}
}
