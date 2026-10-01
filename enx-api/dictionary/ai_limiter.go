package dictionary

import (
	"sync"
	"time"
)

// AILimits are the ceilings MemoryLimiter enforces. A zero value means no
// ceiling of that kind, so a limit left unconfigured never blocks anyone; the
// real values come from configuration (ADR-045 Decision 8) and are starting
// guesses to be tuned from usage.
type AILimits struct {
	CallsPerMinute    int
	CallsPerDay       int
	CacheWritesPerDay int
}

// MemoryLimiter is an AILimiter that counts in process memory. It is a
// safety valve, not an accounting system: the counts start over when the
// server restarts, which only ever lets a few more calls through.
type MemoryLimiter struct {
	mu     sync.Mutex
	limits AILimits
	now    func() time.Time
	users  map[string]*aiUsage
}

type aiUsage struct {
	recentCalls []time.Time // within the last minute
	day         string      // the UTC day the counters below belong to
	calls       int
	writes      int
}

// pruneAbove: once this many users are tracked, idle ones are dropped.
const pruneAbove = 4096

// NewMemoryLimiter returns a limiter enforcing limits. now is the clock; nil
// means time.Now.
func NewMemoryLimiter(limits AILimits, now func() time.Time) *MemoryLimiter {
	if now == nil {
		now = time.Now
	}
	return &MemoryLimiter{limits: limits, now: now, users: map[string]*aiUsage{}}
}

// usage returns userID's counters, started over if the UTC day has changed.
// Callers hold l.mu.
func (l *MemoryLimiter) usage(userID string, now time.Time) *aiUsage {
	day := now.UTC().Format("2006-01-02")
	u, ok := l.users[userID]
	if !ok {
		if len(l.users) >= pruneAbove {
			l.prune(day, now)
		}
		u = &aiUsage{day: day}
		l.users[userID] = u
	}
	if u.day != day {
		u.day, u.calls, u.writes = day, 0, 0
	}
	return u
}

// prune drops users with no activity today and none in the last minute.
func (l *MemoryLimiter) prune(day string, now time.Time) {
	for id, u := range l.users {
		if u.day != day && !hasCallSince(u.recentCalls, now.Add(-time.Minute)) {
			delete(l.users, id)
		}
	}
}

func hasCallSince(calls []time.Time, since time.Time) bool {
	for _, t := range calls {
		if t.After(since) {
			return true
		}
	}
	return false
}

func (l *MemoryLimiter) AllowCall(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	u := l.usage(userID, now)

	cutoff := now.Add(-time.Minute)
	kept := u.recentCalls[:0]
	for _, t := range u.recentCalls {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	u.recentCalls = kept

	if l.limits.CallsPerMinute > 0 && len(u.recentCalls) >= l.limits.CallsPerMinute {
		return false
	}
	if l.limits.CallsPerDay > 0 && u.calls >= l.limits.CallsPerDay {
		return false
	}
	u.recentCalls = append(u.recentCalls, now)
	u.calls++
	return true
}

func (l *MemoryLimiter) AllowCacheWrite(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	u := l.usage(userID, l.now())
	if l.limits.CacheWritesPerDay > 0 && u.writes >= l.limits.CacheWritesPerDay {
		return false
	}
	u.writes++
	return true
}
