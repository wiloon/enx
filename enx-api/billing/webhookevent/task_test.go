package webhookevent

import (
	"errors"
	"testing"
	"time"

	"enx-api/billing/alert"
)

var (
	t0       = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	lease    = 2 * time.Minute
	minDelay = 5 * time.Second
	maxDelay = 15 * time.Minute
	deadline = 24 * time.Hour
)

func TestNewTask(t *testing.T) {
	got := NewTask("invoice.paid", "sub_a", t0)
	want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Pending, NextAttemptAt: t0}
	if got != want {
		t.Errorf("NewTask = %+v, want %+v", got, want)
	}
}

func TestTaskDue(t *testing.T) {
	claimed := Task{Type: "checkout.session.completed", Status: Processing, NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)}
	cases := []struct {
		name         string
		task         Task
		now          time.Time
		backfillDone bool
		want         bool
	}{
		{name: "a new task is due at once", task: NewTask("checkout.session.completed", "", t0), now: t0, backfillDone: true, want: true},
		{name: "a task retried later waits for its next attempt", task: Task{Status: Pending, Attempts: 1, NextAttemptAt: t0.Add(minDelay)}, now: t0, backfillDone: true},
		{name: "a task retried later is due at its next attempt", task: Task{Status: Pending, Attempts: 1, NextAttemptAt: t0.Add(minDelay)}, now: t0.Add(minDelay), backfillDone: true, want: true},
		{name: "a waiting task is due at its next attempt", task: Task{Status: WaitingDependency, Attempts: 1, FirstWaitAt: t0, NextAttemptAt: t0.Add(minDelay)}, now: t0.Add(minDelay), backfillDone: true, want: true},
		{name: "a live claim keeps every other worker away", task: claimed, now: t0.Add(time.Minute), backfillDone: true},
		{name: "an expired claim is recovered after a crash", task: claimed, now: t0.Add(lease), backfillDone: true, want: true},
		{name: "a processed task is never due", task: Task{Status: Processed, CompletedAt: t0}, now: t0.Add(time.Hour), backfillDone: true},
		{name: "an ignored task is never due", task: Task{Status: Ignored, LastError: "unsupported_event_type", CompletedAt: t0}, now: t0.Add(time.Hour), backfillDone: true},
		{name: "a task needing attention waits for an administrator", task: Task{Status: NeedsAttention, LastError: "unsupported_api_version"}, now: t0.Add(time.Hour), backfillDone: true},
		{
			name: "a subscription invoice.paid waits until the legacy provenance backfill finishes",
			task: NewTask("invoice.paid", "sub_a", t0), now: t0.Add(time.Hour), backfillDone: false,
		},
		{
			name: "a subscription invoice.paid is due once the backfill finished",
			task: NewTask("invoice.paid", "sub_a", t0), now: t0, backfillDone: true, want: true,
		},
		{
			name: "an invoice.paid without a subscription does not wait for the backfill",
			task: NewTask("invoice.paid", "", t0), now: t0, backfillDone: false, want: true,
		},
		{
			name: "other events of a subscription do not wait for the backfill",
			task: NewTask("customer.subscription.updated", "sub_a", t0), now: t0, backfillDone: false, want: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.task.Due(tc.now, tc.backfillDone); got != tc.want {
				t.Errorf("Due = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestClaimTask(t *testing.T) {
	due := NewTask("checkout.session.completed", "sub_a", t0)

	got, err := ClaimTask(due, "tok_a", t0, lease, true)
	if err != nil {
		t.Fatal(err)
	}
	want := due
	want.Status, want.ClaimToken, want.ClaimExpiresAt = Processing, "tok_a", t0.Add(lease)
	if got != want {
		t.Errorf("ClaimTask = %+v, want %+v", got, want)
	}

	t.Run("a second worker cannot claim a live claim", func(t *testing.T) {
		if _, err := ClaimTask(got, "tok_b", t0.Add(time.Minute), lease, true); !errors.Is(err, ErrNotDue) {
			t.Errorf("err = %v, want ErrNotDue", err)
		}
	})
	t.Run("another worker takes over an expired claim", func(t *testing.T) {
		taken, err := ClaimTask(got, "tok_b", t0.Add(lease), lease, true)
		if err != nil {
			t.Fatal(err)
		}
		if taken.ClaimToken != "tok_b" || !taken.ClaimExpiresAt.Equal(t0.Add(2*lease)) {
			t.Errorf("ClaimTask after expiry = %+v, want tok_b until %v", taken, t0.Add(2*lease))
		}
	})
	t.Run("a subscription invoice.paid cannot be claimed before the backfill finishes", func(t *testing.T) {
		if _, err := ClaimTask(NewTask("invoice.paid", "sub_a", t0), "tok_a", t0, lease, false); !errors.Is(err, ErrNotDue) {
			t.Errorf("err = %v, want ErrNotDue", err)
		}
	})
	t.Run("a claim needs a token", func(t *testing.T) {
		if _, err := ClaimTask(due, "", t0, lease, true); !errors.Is(err, ErrNoToken) {
			t.Errorf("err = %v, want ErrNoToken", err)
		}
	})
}

func TestRenewTask(t *testing.T) {
	claimed, err := ClaimTask(NewTask("invoice.paid", "sub_a", t0), "tok_a", t0, lease, true)
	if err != nil {
		t.Fatal(err)
	}
	got, err := RenewTask(claimed, "tok_a", t0.Add(time.Minute), lease)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ClaimExpiresAt.Equal(t0.Add(time.Minute + lease)) {
		t.Errorf("renewed claim expires at %v, want %v", got.ClaimExpiresAt, t0.Add(time.Minute+lease))
	}
	t.Run("a worker whose claim was taken over cannot renew it", func(t *testing.T) {
		taken := claimed
		taken.ClaimToken = "tok_b"
		if _, err := RenewTask(taken, "tok_a", t0.Add(time.Minute), lease); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("err = %v, want ErrStaleClaim", err)
		}
	})
}

func TestTaskOutcomes(t *testing.T) {
	claimed := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Processing, Attempts: 2, LastError: "stripe: timeout", NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)}
	done := t0.Add(time.Minute)

	t.Run("completing records the time and clears the claim and error", func(t *testing.T) {
		got, err := Complete(claimed, "tok_a", done)
		if err != nil {
			t.Fatal(err)
		}
		want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Processed, Attempts: 3, NextAttemptAt: t0, CompletedAt: done}
		if got != want {
			t.Errorf("Complete = %+v, want %+v", got, want)
		}
	})
	t.Run("ignoring keeps the reason", func(t *testing.T) {
		got, err := Ignore(claimed, "tok_a", done, "unsupported_event_type")
		if err != nil {
			t.Fatal(err)
		}
		want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Ignored, Attempts: 3, LastError: "unsupported_event_type", NextAttemptAt: t0, CompletedAt: done}
		if got != want {
			t.Errorf("Ignore = %+v, want %+v", got, want)
		}
	})
	t.Run("a transient failure requeues with bounded backoff", func(t *testing.T) {
		got, err := RetryLater(claimed, "tok_a", done, "database is locked", minDelay, maxDelay)
		if err != nil {
			t.Fatal(err)
		}
		want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Pending, Attempts: 3, LastError: "database is locked", NextAttemptAt: done.Add(20 * time.Second)}
		if got != want {
			t.Errorf("RetryLater = %+v, want %+v", got, want)
		}
	})
	t.Run("transient failures retry forever at the capped delay", func(t *testing.T) {
		task := NewTask("invoice.paid", "sub_a", t0)
		var err error
		var delay time.Duration
		for i := range 100 {
			now := task.NextAttemptAt
			if task, err = ClaimTask(task, "tok", now, lease, true); err != nil {
				t.Fatalf("attempt %d: ClaimTask: %v", i, err)
			}
			if task, err = RetryLater(task, "tok", now, "stripe: 500", minDelay, maxDelay); err != nil {
				t.Fatalf("attempt %d: RetryLater: %v", i, err)
			}
			delay = task.NextAttemptAt.Sub(now)
		}
		if task.Status != Pending || task.Attempts != 100 || delay != maxDelay {
			t.Errorf("after 100 transient failures: %+v with delay %v, want pending after 100 attempts at %v", task, delay, maxDelay)
		}
	})
	t.Run("escalating raises the alert and clears the claim", func(t *testing.T) {
		got, err := Escalate(claimed, "tok_a", done, "unsupported_api_version")
		if err != nil {
			t.Fatal(err)
		}
		want := Task{
			Type: "invoice.paid", SubscriptionID: "sub_a", Status: NeedsAttention, Attempts: 3, LastError: "unsupported_api_version", NextAttemptAt: t0,
			Alert: alert.Alert{State: alert.Pending, NextAttemptAt: done},
		}
		if got != want {
			t.Errorf("Escalate = %+v, want %+v", got, want)
		}
	})
	t.Run("a worker whose claim was taken over records no outcome", func(t *testing.T) {
		taken := claimed
		taken.ClaimToken = "tok_b"
		if _, err := Complete(taken, "tok_a", done); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("Complete err = %v, want ErrStaleClaim", err)
		}
		if _, err := Ignore(taken, "tok_a", done, "x"); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("Ignore err = %v, want ErrStaleClaim", err)
		}
		if _, err := RetryLater(taken, "tok_a", done, "x", minDelay, maxDelay); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("RetryLater err = %v, want ErrStaleClaim", err)
		}
		if _, err := WaitForDependency(taken, "tok_a", done, "x", deadline, minDelay, maxDelay); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("WaitForDependency err = %v, want ErrStaleClaim", err)
		}
		if _, err := Escalate(taken, "tok_a", done, "x"); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("Escalate err = %v, want ErrStaleClaim", err)
		}
	})
	t.Run("a task nobody claimed records no outcome", func(t *testing.T) {
		if _, err := Complete(NewTask("invoice.paid", "sub_a", t0), "tok_a", done); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("err = %v, want ErrStaleClaim", err)
		}
	})
}

func TestWaitForDependency(t *testing.T) {
	claim := func(task Task, now time.Time) Task {
		t.Helper()
		claimed, err := ClaimTask(task, "tok", now, lease, true)
		if err != nil {
			t.Fatal(err)
		}
		return claimed
	}

	t.Run("the first wait starts the deadline clock", func(t *testing.T) {
		got, err := WaitForDependency(claim(NewTask("invoice.paid", "sub_a", t0), t0), "tok", t0, "subscription_not_attributed", deadline, minDelay, maxDelay)
		if err != nil {
			t.Fatal(err)
		}
		want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 1, LastError: "subscription_not_attributed", FirstWaitAt: t0, NextAttemptAt: t0.Add(minDelay)}
		if got != want {
			t.Errorf("WaitForDependency = %+v, want %+v", got, want)
		}
	})
	t.Run("later waits keep the first wait", func(t *testing.T) {
		waiting := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 4, FirstWaitAt: t0, NextAttemptAt: t0.Add(23 * time.Hour)}
		now := t0.Add(23 * time.Hour)
		got, err := WaitForDependency(claim(waiting, now), "tok", now, "subscription_not_attributed", deadline, minDelay, maxDelay)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != WaitingDependency || !got.FirstWaitAt.Equal(t0) || got.Attempts != 5 {
			t.Errorf("WaitForDependency = %+v, want waiting since %v after 5 attempts", got, t0)
		}
	})
	t.Run("a transient failure in between keeps the first wait", func(t *testing.T) {
		waiting := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 1, FirstWaitAt: t0, NextAttemptAt: t0.Add(minDelay)}
		now := t0.Add(minDelay)
		got, err := RetryLater(claim(waiting, now), "tok", now, "stripe: 500", minDelay, maxDelay)
		if err != nil {
			t.Fatal(err)
		}
		if !got.FirstWaitAt.Equal(t0) {
			t.Errorf("RetryLater FirstWaitAt = %v, want %v", got.FirstWaitAt, t0)
		}
	})
	t.Run("at the deadline the task needs attention with a pending alert", func(t *testing.T) {
		waiting := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 9, FirstWaitAt: t0, NextAttemptAt: t0.Add(deadline)}
		now := t0.Add(deadline)
		got, err := WaitForDependency(claim(waiting, now), "tok", now, "subscription_not_attributed", deadline, minDelay, maxDelay)
		if err != nil {
			t.Fatal(err)
		}
		want := Task{
			Type: "invoice.paid", SubscriptionID: "sub_a", Status: NeedsAttention, Attempts: 10, LastError: "subscription_not_attributed", FirstWaitAt: t0, NextAttemptAt: t0.Add(deadline),
			Alert: alert.Alert{State: alert.Pending, NextAttemptAt: now},
		}
		if got != want {
			t.Errorf("WaitForDependency = %+v, want %+v", got, want)
		}
	})
}

func TestWake(t *testing.T) {
	waiting := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 6, FirstWaitAt: t0, NextAttemptAt: t0.Add(maxDelay)}
	now := t0.Add(time.Minute)

	got := Wake(waiting, now)
	want := waiting
	want.NextAttemptAt = now
	if got != want {
		t.Errorf("Wake = %+v, want %+v", got, want)
	}
	if !got.Due(now, true) {
		t.Error("a woken task must be due at once")
	}

	later := t0.Add(maxDelay)
	for _, task := range []Task{
		{Status: Pending, Attempts: 2, NextAttemptAt: later},
		{Status: Processing, ClaimToken: "tok", ClaimExpiresAt: t0.Add(lease), NextAttemptAt: later},
		{Status: Processed, NextAttemptAt: later, CompletedAt: t0},
		{Status: NeedsAttention, LastError: "subscription_not_attributed", NextAttemptAt: later},
	} {
		if got := Wake(task, now); got != task {
			t.Errorf("Wake(%s) = %+v, want it unchanged", task.Status, got)
		}
	}
}

func TestRetryByOperator(t *testing.T) {
	sentAlert := alert.Alert{State: alert.Sent, Attempts: 1, SentAt: t0.Add(time.Hour)}
	attention := Task{Type: "charge.refunded", Status: NeedsAttention, Attempts: 7, LastError: "refund_unmatched", FirstWaitAt: t0, NextAttemptAt: t0.Add(deadline), Alert: sentAlert}
	now := t0.Add(48 * time.Hour)

	got, err := RetryByOperator(attention, now)
	if err != nil {
		t.Fatal(err)
	}
	want := attention
	want.Status, want.NextAttemptAt = Pending, now
	if got != want {
		t.Errorf("RetryByOperator = %+v, want %+v", got, want)
	}

	t.Run("a retried task that still lacks its dependency needs attention again without another mail", func(t *testing.T) {
		claimed, err := ClaimTask(got, "tok", now, lease, true)
		if err != nil {
			t.Fatal(err)
		}
		again, err := WaitForDependency(claimed, "tok", now, "refund_unmatched", deadline, minDelay, maxDelay)
		if err != nil {
			t.Fatal(err)
		}
		if again.Status != NeedsAttention || again.Alert != sentAlert {
			t.Errorf("after retry: %+v, want needs_attention with the sent alert %+v", again, sentAlert)
		}
	})
	t.Run("only a task needing attention can be retried", func(t *testing.T) {
		for _, task := range []Task{
			NewTask("invoice.paid", "sub_a", t0),
			{Status: Processing, ClaimToken: "tok", ClaimExpiresAt: now.Add(lease)},
			{Status: WaitingDependency, FirstWaitAt: t0, NextAttemptAt: now},
			{Status: Processed, CompletedAt: t0},
			{Status: Ignored, LastError: "unsupported_event_type", CompletedAt: t0},
		} {
			if _, err := RetryByOperator(task, now); !errors.Is(err, ErrNotRetryable) {
				t.Errorf("RetryByOperator(%s) err = %v, want ErrNotRetryable", task.Status, err)
			}
		}
	})
}
