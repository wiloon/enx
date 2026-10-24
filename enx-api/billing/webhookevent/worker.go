package webhookevent

import (
	"context"
	"errors"
	"time"
)

// Effects are the local changes a handled event commits together with its
// task's next state, in one transaction: a credit grant and its ledger row,
// an acceptance or conflict classification, a snapshot refresh, an
// association that wakes waiting tasks. The worker passes them through
// untouched; the store knows how to apply them. Nil means none.
type Effects any

// StoredTask is an event task as the store read it, with what the worker
// needs to route it. The handler loads the original payload by Scope.
type StoredTask struct {
	Scope      Scope
	APIVersion string
	Task       Task
}

// TaskStore reads and writes webhook event tasks.
type TaskStore interface {
	// Unfinished returns every pending, processing or waiting task; the
	// worker decides which are due.
	Unfinished(ctx context.Context) ([]StoredTask, error)
	// LegacyBackfillDone reports whether the one-time legacy provenance
	// backfill has recorded that it finished.
	LegacyBackfillDone(ctx context.Context) (bool, error)
	// Save writes next as scope's task, and applies effects, in one
	// transaction, only while the stored task's Status, Attempts and
	// ClaimToken still equal read's; otherwise it returns ErrStaleClaim and
	// changes nothing. Together they change on every transition, so a
	// worker whose claim was taken over can commit neither its effects nor
	// its outcome. Any other error leaves the task and its effects as they
	// were, including a revalidation failure of the effects themselves.
	Save(ctx context.Context, scope Scope, read, next Task, effects Effects) error
}

// Step is what a handler found an event needs next.
type Step int

const (
	// Handled: the event's required business effects are in Effects, or a
	// known conflict context is durably routed there.
	Handled Step = iota
	// NoEffect: the event has no supported business effect; Reason says
	// why.
	NoEffect
	// Transient: a Stripe or storage failure; retry with backoff.
	Transient
	// MissingDependency: the event still lacks its checkout, subscription or
	// grant association; wait, and need attention at the deadline.
	MissingDependency
	// Unrecoverable: no retry can fix it (an unknown Price, contradictory
	// trusted identities, a payment after account deletion).
	Unrecoverable
)

// Result is a handler's verdict on one event. Effects are committed with
// the task's next state whatever the step, so a handler can record
// investigation context with an escalation.
type Result struct {
	Step    Step
	Reason  string
	Effects Effects
}

// Handler decides one event of kind. It reads Stripe outside any database
// transaction and returns the local changes as Effects instead of writing
// them, so they commit with the task under the worker's claim. A context
// error (the operation timeout) is a Transient result.
type Handler interface {
	Handle(ctx context.Context, kind Kind, s StoredTask) Result
}

// WorkerSettings are the stripe.webhook worker settings. Timeout must be
// shorter than Lease, so a claim cannot lapse while its handler may still
// finish.
type WorkerSettings struct {
	// Timeout bounds one event's handling (operation-timeout).
	Timeout time.Duration
	// Lease is how long a claim keeps other workers away (lease-duration).
	Lease time.Duration
	// BackoffMin and BackoffMax bound retry delays (backoff-min,
	// backoff-max).
	BackoffMin time.Duration
	BackoffMax time.Duration
	// DependencyWaitDeadline runs from an event's first dependency wait
	// (dependency-wait-deadline).
	DependencyWaitDeadline time.Duration
}

// WorkerReport counts the outcomes a pass committed.
type WorkerReport struct {
	Processed      int
	Ignored        int
	Retried        int
	Waiting        int
	NeedsAttention int
}

// Worker processes durably received Stripe webhook events (ADR-067): at
// startup and on every poll tick or wake-up it claims each due task, has
// the handler decide it outside any transaction, and commits the outcome
// and its effects under that claim. Several workers may share one store;
// the claim keeps them from applying the same event twice.
type Worker struct {
	store    TaskStore
	handler  Handler
	settings WorkerSettings
	now      func() time.Time
	newToken func() string
}

// NewWorker returns a worker. newToken must return a fresh, unique claim
// token on every call.
func NewWorker(store TaskStore, handler Handler, settings WorkerSettings, now func() time.Time, newToken func() string) *Worker {
	return &Worker{store: store, handler: handler, settings: settings, now: now, newToken: newToken}
}

// Run makes a startup pass, then a pass on every tick, until ctx is done.
// The caller feeds ticks from its poll ticker and from wake-ups. report
// gets each pass's outcome.
func (w *Worker) Run(ctx context.Context, ticks <-chan time.Time, report func(WorkerReport, error)) {
	report(w.Pass(ctx))
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			report(w.Pass(ctx))
		}
	}
}

// Pass handles every due task once. Storage failures are returned and do
// not stop the pass.
func (w *Worker) Pass(ctx context.Context) (WorkerReport, error) {
	backfillDone, err := w.store.LegacyBackfillDone(ctx)
	if err != nil {
		return WorkerReport{}, err
	}
	tasks, err := w.store.Unfinished(ctx)
	if err != nil {
		return WorkerReport{}, err
	}
	var report WorkerReport
	var errs []error
	for _, s := range tasks {
		status, err := w.process(ctx, s, backfillDone)
		switch {
		case errors.Is(err, errSkipped):
		case err != nil:
			errs = append(errs, err)
		default:
			report.count(status)
		}
	}
	return report, errors.Join(errs...)
}

func (r *WorkerReport) count(status Status) {
	switch status {
	case Processed:
		r.Processed++
	case Ignored:
		r.Ignored++
	case Pending:
		r.Retried++
	case WaitingDependency:
		r.Waiting++
	case NeedsAttention:
		r.NeedsAttention++
	}
}

// errSkipped: the task was not due, or another worker holds it.
var errSkipped = errors.New("billing/webhookevent: skipped")

// process claims, handles and commits one task, returning the status it
// committed.
func (w *Worker) process(ctx context.Context, s StoredTask, backfillDone bool) (Status, error) {
	token := w.newToken()
	claimed, err := ClaimTask(s.Task, token, w.now(), w.settings.Lease, backfillDone)
	if err != nil {
		return "", errSkipped
	}
	if err := w.save(ctx, s.Scope, s.Task, claimed, nil); err != nil {
		return "", err
	}

	result := w.decide(ctx, s)
	next, err := w.outcome(claimed, token, result)
	if err != nil {
		return "", err
	}
	err = w.save(ctx, s.Scope, claimed, next, result.Effects)
	if err == nil || errors.Is(err, errSkipped) {
		return next.Status, err
	}

	// The effects did not commit; record why and retry them later rather
	// than leaving the claim to expire.
	retry, rerr := RetryLater(claimed, token, w.now(), err.Error(), w.settings.BackoffMin, w.settings.BackoffMax)
	if rerr != nil {
		return "", rerr
	}
	if serr := w.save(ctx, s.Scope, claimed, retry, nil); serr != nil {
		return "", errors.Join(err, serr)
	}
	return retry.Status, nil
}

// decide routes the event and, for a supported business event its API
// version can read, asks the handler under the operation timeout.
func (w *Worker) decide(ctx context.Context, s StoredTask) Result {
	routing := Route(s.Task.Type, s.APIVersion)
	switch routing.Kind {
	case KindIgnore:
		return Result{Step: NoEffect, Reason: routing.Reason}
	case KindEscalate:
		return Result{Step: Unrecoverable, Reason: routing.Reason}
	}
	opCtx, cancel := context.WithTimeout(ctx, w.settings.Timeout)
	defer cancel()
	return w.handler.Handle(opCtx, routing.Kind, s)
}

// outcome is the task state that records result under token.
func (w *Worker) outcome(t Task, token string, result Result) (Task, error) {
	now := w.now()
	switch result.Step {
	case Handled:
		return Complete(t, token, now)
	case NoEffect:
		return Ignore(t, token, now, result.Reason)
	case MissingDependency:
		return WaitForDependency(t, token, now, result.Reason, w.settings.DependencyWaitDeadline, w.settings.BackoffMin, w.settings.BackoffMax)
	case Unrecoverable:
		return Escalate(t, token, now, result.Reason)
	}
	return RetryLater(t, token, now, result.Reason, w.settings.BackoffMin, w.settings.BackoffMax)
}

// save writes next under the conditional write, reporting a lost claim as
// errSkipped.
func (w *Worker) save(ctx context.Context, scope Scope, read, next Task, effects Effects) error {
	err := w.store.Save(ctx, scope, read, next, effects)
	if errors.Is(err, ErrStaleClaim) {
		return errSkipped
	}
	return err
}
