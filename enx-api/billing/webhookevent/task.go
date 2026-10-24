package webhookevent

import (
	"errors"
	"time"

	"enx-api/billing/alert"
)

var (
	// ErrNotDue: the task is finished, needs attention, under another
	// worker's live claim, not yet at its next attempt, or held for the
	// legacy provenance backfill.
	ErrNotDue = errors.New("billing/webhookevent: task is not due")
	// ErrNoToken: a claim needs a nonempty fencing token.
	ErrNoToken = errors.New("billing/webhookevent: claim token is empty")
	// ErrStaleClaim: the caller no longer holds the claim; another worker
	// took it over, so this one must not commit an effect or an outcome.
	ErrStaleClaim = errors.New("billing/webhookevent: claim is no longer held")
	// ErrNotRetryable: only a task that needs attention can be retried by an
	// administrator.
	ErrNotRetryable = errors.New("billing/webhookevent: only a task that needs attention can be retried")
)

// Task is the processing state of one scoped Stripe webhook event. The
// caller stores the returned state with a conditional write on the claim
// token it read, in the same transaction as the event's financial effects.
// Repeated deliveries of the event reuse the task and never change it.
type Task struct {
	// Type and SubscriptionID come from the receipt: the event type and the
	// Subscription ID parsed from its payload, if any.
	Type           string
	SubscriptionID string

	Status        Status
	Attempts      int
	LastError     string
	FirstWaitAt   time.Time
	NextAttemptAt time.Time
	CompletedAt   time.Time

	ClaimToken     string
	ClaimExpiresAt time.Time

	// Alert is the task's administrator alert, raised when it first needs
	// attention.
	Alert alert.Alert
}

// NewTask is the task receipt creates for a newly received event, due at
// once.
func NewTask(eventType, subscriptionID string, now time.Time) Task {
	return Task{Type: eventType, SubscriptionID: subscriptionID, Status: Pending, NextAttemptAt: now}
}

// Due reports whether a worker may claim the task at now. A paid invoice of
// a subscription waits until the one-time legacy provenance backfill has
// finished (ADR-067 §一次性充值与 Stripe Customer), so an upgrade invoice
// queued before it never mistakes "not backfilled yet" for "no grant yet".
func (t Task) Due(now time.Time, legacyBackfillDone bool) bool {
	if !legacyBackfillDone && t.Type == "invoice.paid" && t.SubscriptionID != "" {
		return false
	}
	switch t.Status {
	case Pending, WaitingDependency:
		return !now.Before(t.NextAttemptAt)
	case Processing:
		return !now.Before(t.ClaimExpiresAt)
	}
	return false
}

// ClaimTask gives the task to the worker holding token until now+lease. An
// expired claim of a crashed worker is taken over. The lease must outlast
// the operation timeout.
func ClaimTask(t Task, token string, now time.Time, lease time.Duration, legacyBackfillDone bool) (Task, error) {
	if token == "" {
		return t, ErrNoToken
	}
	if !t.Due(now, legacyBackfillDone) {
		return t, ErrNotDue
	}
	t.Status = Processing
	t.ClaimToken = token
	t.ClaimExpiresAt = now.Add(lease)
	return t, nil
}

// RenewTask extends a long-running claim to now+lease.
func RenewTask(t Task, token string, now time.Time, lease time.Duration) (Task, error) {
	if !holds(t, token) {
		return t, ErrStaleClaim
	}
	t.ClaimExpiresAt = now.Add(lease)
	return t, nil
}

// Complete records that the event's required business effects are done.
func Complete(t Task, token string, now time.Time) (Task, error) {
	if !holds(t, token) {
		return t, ErrStaleClaim
	}
	t = release(t)
	t.Status = Processed
	t.LastError = ""
	t.CompletedAt = now
	return t, nil
}

// Ignore records that the event has no supported business effect, keeping
// the reason.
func Ignore(t Task, token string, now time.Time, reason string) (Task, error) {
	if !holds(t, token) {
		return t, ErrStaleClaim
	}
	t = release(t)
	t.Status = Ignored
	t.LastError = reason
	t.CompletedAt = now
	return t, nil
}

// RetryLater requeues the task after a transient Stripe or storage failure,
// with exponential backoff capped at maxDelay. Transient failures never
// give up and never touch the dependency-wait clock.
func RetryLater(t Task, token string, now time.Time, reason string, minDelay, maxDelay time.Duration) (Task, error) {
	if !holds(t, token) {
		return t, ErrStaleClaim
	}
	t = release(t)
	t.Status = Pending
	t.LastError = reason
	t.NextAttemptAt = now.Add(Backoff(t.Attempts, minDelay, maxDelay))
	return t, nil
}

// WaitForDependency records that the event still lacks its checkout,
// subscription or grant association. It waits with backoff, or wakes
// earlier when the association arrives (Wake). From the first wait onward,
// once deadline has passed, the task needs attention and raises its alert.
func WaitForDependency(t Task, token string, now time.Time, reason string, deadline, minDelay, maxDelay time.Duration) (Task, error) {
	if !holds(t, token) {
		return t, ErrStaleClaim
	}
	status, firstWaitAt := AfterMissingDependency(t.FirstWaitAt, now, deadline)
	t.FirstWaitAt = firstWaitAt
	if status == NeedsAttention {
		return escalate(t, now, reason), nil
	}
	t = release(t)
	t.Status = WaitingDependency
	t.LastError = reason
	t.NextAttemptAt = now.Add(Backoff(t.Attempts, minDelay, maxDelay))
	return t, nil
}

// Escalate records a problem no retry can fix (an unsupported API version,
// contradictory trusted identities, an unknown Price): the task needs
// attention and raises its alert in the same write.
func Escalate(t Task, token string, now time.Time, reason string) (Task, error) {
	if !holds(t, token) {
		return t, ErrStaleClaim
	}
	return escalate(t, now, reason), nil
}

// Wake makes a waiting task due at now, once the association it waits for
// has been stored. Periodic polling recovers a wake-up that was lost. Any
// other task is returned unchanged.
func Wake(t Task, now time.Time) Task {
	if t.Status == WaitingDependency && now.Before(t.NextAttemptAt) {
		t.NextAttemptAt = now
	}
	return t
}

// RetryByOperator requeues a task that needs attention when an
// administrator retries it. The event, its idempotency keys, its
// dependency-wait clock and its alert are kept: a retry that still lacks
// its dependency needs attention again at once, and a sent alert is not
// sent again.
func RetryByOperator(t Task, now time.Time) (Task, error) {
	if t.Status != NeedsAttention {
		return t, ErrNotRetryable
	}
	t.Status = Pending
	t.NextAttemptAt = now
	return t, nil
}

// AlertToSave is the alert a task save leaves stored, given the one stored
// now and the one the saved task carries. Delivery progress belongs to the
// notifier, which records it with its own conditional write, so a task save
// never overwrites it: it only raises an alert where none was raised yet.
// The store applies this in the same atomic write as the task.
func AlertToSave(stored, next alert.Alert) alert.Alert {
	if stored.State != "" {
		return stored
	}
	return next
}

func escalate(t Task, now time.Time, reason string) Task {
	t = release(t)
	t.Status = NeedsAttention
	t.LastError = reason
	t.Alert = alert.Raise(t.Alert, now)
	return t
}

// release records one finished attempt and drops the claim.
func release(t Task) Task {
	t.Attempts++
	t.ClaimToken = ""
	t.ClaimExpiresAt = time.Time{}
	return t
}

// holds reports whether token is the task's current claim. A worker whose
// lease lapsed still holds the claim until another worker takes it over;
// the token, not the clock, fences the commit.
func holds(t Task, token string) bool {
	return t.Status == Processing && token != "" && t.ClaimToken == token
}
