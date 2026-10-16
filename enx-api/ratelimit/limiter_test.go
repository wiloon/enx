package ratelimit

import (
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)}
}

// spend calls Allow n times and fails the test on the first refusal.
func spend(t *testing.T, l *MemoryLimiter, userID string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if ok, _ := l.Allow(userID); !ok {
			t.Fatalf("request %d of %d for %s refused", i+1, n, userID)
		}
	}
}

func TestAFullBucketLetsABurstThroughThenRefusesWithRetryAfter(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 5, Burst: 60}, clock.now)

	spend(t, l, "u1", 60)

	ok, retryAfter := l.Allow("u1")
	if ok {
		t.Fatal("request 61 in the same instant allowed; want refused")
	}
	// The next token is 200ms away; Retry-After is whole seconds, at least 1.
	if retryAfter != time.Second {
		t.Fatalf("retryAfter = %v, want 1s", retryAfter)
	}
}

func TestRetryAfterRoundsUpToWholeSeconds(t *testing.T) {
	clock := newClock()
	// One token every 2.5s: the next one is 2.5s away, so Retry-After is 3s.
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 0.4, Burst: 1}, clock.now)

	spend(t, l, "u1", 1)

	if _, retryAfter := l.Allow("u1"); retryAfter != 3*time.Second {
		t.Fatalf("retryAfter = %v, want 3s", retryAfter)
	}
}

func TestTokensRefillAtTheConfiguredRate(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 5, Burst: 60}, clock.now)
	spend(t, l, "u1", 60)

	clock.advance(time.Second)
	spend(t, l, "u1", 5)
	if ok, _ := l.Allow("u1"); ok {
		t.Fatal("sixth request one second after an empty bucket allowed; want refused")
	}

	// 12 idle seconds fill the bucket again, and never past its size.
	clock.advance(time.Minute)
	spend(t, l, "u1", 60)
	if ok, _ := l.Allow("u1"); ok {
		t.Fatal("bucket refilled past its burst size")
	}
}

func TestARefusedRequestDoesNotUseAToken(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 5, Burst: 60}, clock.now)
	spend(t, l, "u1", 60)

	// A script hammering an empty bucket must not push its own wait further out.
	for i := 0; i < 100; i++ {
		l.Allow("u1")
	}

	clock.advance(200 * time.Millisecond)
	if ok, _ := l.Allow("u1"); !ok {
		t.Fatal("token due after 200ms was spent by refused requests")
	}
}

func TestEachUserHasTheirOwnBucket(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 5, Burst: 60}, clock.now)
	spend(t, l, "u1", 60)

	spend(t, l, "u2", 60)
}

func TestZeroRateMeansNoLimit(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 0, Burst: 60}, clock.now)

	spend(t, l, "u1", 10_000)
}

func TestIdleBucketsArePrunedOnceManyUsersAreTracked(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 5, Burst: 60}, clock.now)
	for i := 0; i < pruneAbove; i++ {
		l.Allow(string(rune('a'+i%26)) + time.Duration(i).String())
	}
	if got := l.tracked(); got != pruneAbove {
		t.Fatalf("tracked = %d, want %d", got, pruneAbove)
	}

	clock.advance(idleAfter + time.Second)
	spend(t, l, "fresh", 1)

	if got := l.tracked(); got != 1 {
		t.Fatalf("tracked after prune = %d, want 1 (only the new user)", got)
	}
}

func TestPruneKeepsRecentlyActiveUsersBuckets(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{RequestsPerSecond: 5, Burst: 60}, clock.now)
	spend(t, l, "active", 60)
	for i := 1; i < pruneAbove; i++ {
		l.Allow(time.Duration(i).String())
	}

	clock.advance(idleAfter + time.Second)
	spend(t, l, "active", 1) // keeps "active" fresh
	for i := 0; i < 59; i++ {
		l.Allow("active")
	}
	spend(t, l, "newcomer", 1) // over the threshold: prunes

	if ok, _ := l.Allow("active"); ok {
		t.Fatal("active user's emptied bucket was pruned and started over full")
	}
}
