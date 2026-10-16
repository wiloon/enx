// Package ratelimit is the per-user request rate limit on every signed-in
// route (ADR-060): one token bucket per user, the same generous rule for
// everyone, so a person reading never meets it and only scripts do. It is a
// protection mechanism, not a product rule -- the daily lookup quota
// (ADR-029) and the AI safety valves (ailimit) stay separate.
package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limits configure every user's bucket: it refills RequestsPerSecond tokens
// a second and holds at most Burst. RequestsPerSecond = 0 switches the limit
// off.
type Limits struct {
	RequestsPerSecond float64
	Burst             int
}

// Limiter decides whether userID may make one more request now, and if not,
// how long until it may.
type Limiter interface {
	Allow(userID string) (ok bool, retryAfter time.Duration)
}

// MemoryLimiter keeps the buckets in process memory. Losing them on restart
// only hands everyone a full bucket (ADR-060 Decision 5).
type MemoryLimiter struct {
	mu      sync.Mutex
	limits  Limits
	now     func() time.Time
	buckets map[string]*bucket
}

type bucket struct {
	limiter  *rate.Limiter
	lastUsed time.Time
}

const (
	// pruneAbove: once this many users are tracked, idle buckets are dropped.
	pruneAbove = 4096
	// idleAfter: a bucket idle this long is full again, so dropping it and
	// making a new one later changes nothing.
	idleAfter = 10 * time.Minute
)

// NewMemoryLimiter returns a limiter enforcing limits. now is the clock; nil
// means time.Now.
func NewMemoryLimiter(limits Limits, now func() time.Time) *MemoryLimiter {
	if now == nil {
		now = time.Now
	}
	return &MemoryLimiter{limits: limits, now: now, buckets: map[string]*bucket{}}
}

// Allow takes one token from userID's bucket. A refused request takes none,
// so hammering an empty bucket does not push the wait further out.
// retryAfter is whole seconds, at least one, ready for a Retry-After header.
func (l *MemoryLimiter) Allow(userID string) (bool, time.Duration) {
	if l.limits.RequestsPerSecond <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	b, ok := l.buckets[userID]
	if !ok {
		if len(l.buckets) >= pruneAbove {
			l.prune(now)
		}
		b = &bucket{limiter: rate.NewLimiter(rate.Limit(l.limits.RequestsPerSecond), l.limits.Burst)}
		l.buckets[userID] = b
	}
	b.lastUsed = now

	r := b.limiter.ReserveN(now, 1)
	if !r.OK() {
		// Burst < 1: no request can ever fit. Not a configuration we allow,
		// but refuse rather than wait forever.
		return false, time.Second
	}
	delay := r.DelayFrom(now)
	if delay == 0 {
		return true, 0
	}
	r.CancelAt(now)
	return false, wholeSeconds(delay)
}

func wholeSeconds(d time.Duration) time.Duration {
	s := (d + time.Second - 1) / time.Second
	if s < 1 {
		s = 1
	}
	return s * time.Second
}

// prune drops buckets idle for idleAfter. Callers hold l.mu.
func (l *MemoryLimiter) prune(now time.Time) {
	for id, b := range l.buckets {
		if now.Sub(b.lastUsed) >= idleAfter {
			delete(l.buckets, id)
		}
	}
}

// tracked is how many buckets are held; for tests.
func (l *MemoryLimiter) tracked() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
