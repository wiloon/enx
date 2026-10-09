package ailimit

import (
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
}

func TestMemoryLimiterCallsPerMinute(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{CallsPerMinute: 2}, clock.now)

	if !l.AllowCall("u1") || !l.AllowCall("u1") {
		t.Fatal("the first two calls should pass")
	}
	if l.AllowCall("u1") {
		t.Fatal("a third call within the minute should be refused")
	}
	if !l.AllowCall("u2") {
		t.Fatal("another user has their own allowance")
	}
	clock.advance(61 * time.Second)
	if !l.AllowCall("u1") {
		t.Fatal("the window should have slid past the old calls")
	}
}

func TestMemoryLimiterCallsPerDayRollOverAtUTCMidnight(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{CallsPerDay: 2}, clock.now)

	l.AllowCall("u1")
	clock.advance(2 * time.Minute) // outside any per-minute window
	l.AllowCall("u1")
	clock.advance(2 * time.Minute)
	if l.AllowCall("u1") {
		t.Fatal("a third call today should be refused")
	}
	clock.advance(12 * time.Hour) // into the next UTC day
	if !l.AllowCall("u1") {
		t.Fatal("the daily count should have started over")
	}
}

func TestMemoryLimiterARefusedCallIsNotCounted(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{CallsPerMinute: 1, CallsPerDay: 2}, clock.now)

	l.AllowCall("u1")
	for i := 0; i < 5; i++ {
		l.AllowCall("u1") // refused by the per-minute limit
	}
	clock.advance(2 * time.Minute)
	if !l.AllowCall("u1") {
		t.Fatal("refused calls must not have used up the daily allowance")
	}
}

func TestMemoryLimiterCacheWritesPerDay(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{CacheWritesPerDay: 2}, clock.now)

	if !l.AllowCacheWrite("u1") || !l.AllowCacheWrite("u1") {
		t.Fatal("the first two writes should pass")
	}
	if l.AllowCacheWrite("u1") {
		t.Fatal("a third write today should be refused")
	}
	if !l.AllowCacheWrite("u2") {
		t.Fatal("another user has their own allowance")
	}
	clock.advance(24 * time.Hour)
	if !l.AllowCacheWrite("u1") {
		t.Fatal("the count should have started over the next day")
	}
}

func TestMemoryLimiterZeroMeansNoLimit(t *testing.T) {
	l := NewMemoryLimiter(Limits{}, newClock().now)
	for i := 0; i < 1000; i++ {
		if !l.AllowCall("u1") || !l.AllowCacheWrite("u1") {
			t.Fatalf("an unconfigured limit blocked at %d", i)
		}
	}
}

func TestMemoryLimiterForgetsIdleUsers(t *testing.T) {
	clock := newClock()
	l := NewMemoryLimiter(Limits{CallsPerDay: 5}, clock.now)
	for i := 0; i < pruneAbove; i++ {
		l.AllowCall(string(rune('a'+i%26)) + string(rune(i)))
	}
	clock.advance(48 * time.Hour)
	l.AllowCall("fresh") // a new user past the threshold triggers the prune

	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.users) > 2 {
		t.Fatalf("%d users still tracked after two idle days, want the idle ones dropped", len(l.users))
	}
}
