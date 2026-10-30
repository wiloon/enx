package webhookevent

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/billing/alert"
)

// fakeTaskStore keeps tasks in memory and saves with the conditional write
// a repository does: on the status, attempts and claim token read, keeping
// the stored alert's progress. Effects are applied only when that write
// succeeds, as in one transaction.
type fakeTaskStore struct {
	mu         sync.Mutex
	tasks      map[Scope]StoredTask
	applied    []Effects
	listErr    error
	saveErr    map[Scope]error
	effectsErr error
}

func newFakeTaskStore(stored ...StoredTask) *fakeTaskStore {
	s := &fakeTaskStore{tasks: map[Scope]StoredTask{}, saveErr: map[Scope]error{}}
	for _, st := range stored {
		s.tasks[st.Scope] = st
	}
	return s
}

func (s *fakeTaskStore) Unfinished(context.Context) ([]StoredTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listErr != nil {
		return nil, s.listErr
	}
	var out []StoredTask
	for _, st := range s.tasks {
		switch st.Task.Status {
		case Pending, Processing, WaitingDependency:
			out = append(out, st)
		}
	}
	return out, nil
}

func (s *fakeTaskStore) Save(_ context.Context, scope Scope, read, next Task, effects Effects) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.saveErr[scope]; err != nil {
		return err
	}
	cur, ok := s.tasks[scope]
	if !ok || cur.Task.Status != read.Status || cur.Task.Attempts != read.Attempts || cur.Task.ClaimToken != read.ClaimToken {
		return ErrStaleClaim
	}
	if effects != nil {
		if s.effectsErr != nil {
			return s.effectsErr
		}
		s.applied = append(s.applied, effects)
	}
	next.Alert = AlertToSave(cur.Task.Alert, next.Alert)
	cur.Task = next
	s.tasks[scope] = cur
	return nil
}

func (s *fakeTaskStore) get(scope Scope) Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tasks[scope].Task
}

func (s *fakeTaskStore) appliedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.applied)
}

type handled struct {
	Kind     Kind
	Scope    Scope
	Deadline time.Time
}

// fakeHandler returns result for every event and records what it handled.
type fakeHandler struct {
	mu     sync.Mutex
	calls  []handled
	result Result
	handle func(ctx context.Context, s StoredTask) Result
}

func (h *fakeHandler) Handle(ctx context.Context, kind Kind, s StoredTask) Result {
	deadline, _ := ctx.Deadline()
	h.mu.Lock()
	h.calls = append(h.calls, handled{Kind: kind, Scope: s.Scope, Deadline: deadline})
	h.mu.Unlock()
	if h.handle != nil {
		return h.handle(ctx, s)
	}
	return h.result
}

func (h *fakeHandler) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.calls)
}

const dahlia = "2026-08-26.dahlia"

var workerSettings = WorkerSettings{
	Timeout:                30 * time.Second,
	Lease:                  lease,
	BackoffMin:             minDelay,
	BackoffMax:             maxDelay,
	DependencyWaitDeadline: deadline,
}

func scopeOf(eventID string) Scope {
	return Scope{AccountID: "acct_1", EventID: eventID}
}

func newStored(eventID, eventType, subscriptionID string) StoredTask {
	return StoredTask{Scope: scopeOf(eventID), APIVersion: dahlia, Task: NewTask(eventType, subscriptionID, t0)}
}

func clockAt(t time.Time) func() time.Time { return func() time.Time { return t } }

func workerTokens(prefix string) func() string {
	var n atomic.Int64
	return func() string { return fmt.Sprintf("%s_%d", prefix, n.Add(1)) }
}

func pass(t *testing.T, store *fakeTaskStore, h *fakeHandler, now time.Time) WorkerReport {
	t.Helper()
	report, err := NewWorker(store, h, workerSettings, clockAt(now), workerTokens("w")).Pass(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return report
}

func TestWorkerCompletesAHandledEventWithItsEffectsInOneWrite(t *testing.T) {
	ev := newStored("evt_1", "invoice.paid", "sub_a")
	store := newFakeTaskStore(ev)
	h := &fakeHandler{result: Result{Step: Handled, Effects: "grant 1000 credits"}}
	now := t0.Add(time.Second)

	report := pass(t, store, h, now)

	if report != (WorkerReport{Processed: 1}) {
		t.Errorf("report = %+v, want 1 processed", report)
	}
	if len(h.calls) != 1 || h.calls[0].Kind != KindInvoicePaid || h.calls[0].Scope != ev.Scope {
		t.Errorf("handler calls = %+v, want one invoice_paid call for evt_1", h.calls)
	}
	want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Processed, Attempts: 1, NextAttemptAt: t0, CompletedAt: now}
	if got := store.get(ev.Scope); got != want {
		t.Errorf("task = %+v, want %+v", got, want)
	}
	if len(store.applied) != 1 || store.applied[0] != "grant 1000 credits" {
		t.Errorf("applied effects = %v, want the grant once", store.applied)
	}
}

func TestWorkerRecordsEachHandlerResult(t *testing.T) {
	now := t0.Add(time.Second)
	cases := []struct {
		name   string
		task   Task
		result Result
		want   Task
		report WorkerReport
	}{
		{
			name:   "an event with no supported effect is ignored with the reason",
			task:   NewTask("checkout.session.completed", "", t0),
			result: Result{Step: NoEffect, Reason: "not_an_enx_checkout"},
			want:   Task{Type: "checkout.session.completed", Status: Ignored, Attempts: 1, LastError: "not_an_enx_checkout", NextAttemptAt: t0, CompletedAt: now},
			report: WorkerReport{Ignored: 1},
		},
		{
			name:   "a transient Stripe or storage failure retries after backoff",
			task:   NewTask("checkout.session.completed", "", t0),
			result: Result{Step: Transient, Reason: "stripe: 503"},
			want:   Task{Type: "checkout.session.completed", Status: Pending, Attempts: 1, LastError: "stripe: 503", NextAttemptAt: now.Add(minDelay)},
			report: WorkerReport{Retried: 1},
		},
		{
			name:   "a missing association waits and starts the dependency clock",
			task:   NewTask("invoice.paid", "sub_a", t0),
			result: Result{Step: MissingDependency, Reason: "attribution_unresolved"},
			want:   Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 1, LastError: "attribution_unresolved", FirstWaitAt: now, NextAttemptAt: now.Add(minDelay)},
			report: WorkerReport{Waiting: 1},
		},
		{
			name:   "a missing association past the deadline needs attention and raises its alert",
			task:   Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: WaitingDependency, Attempts: 3, FirstWaitAt: now.Add(-deadline), NextAttemptAt: now},
			result: Result{Step: MissingDependency, Reason: "attribution_unresolved"},
			want:   Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: NeedsAttention, Attempts: 4, LastError: "attribution_unresolved", FirstWaitAt: now.Add(-deadline), NextAttemptAt: now, Alert: alert.Alert{State: alert.Pending, NextAttemptAt: now}},
			report: WorkerReport{NeedsAttention: 1},
		},
		{
			name:   "a problem no retry can fix needs attention at once",
			task:   NewTask("invoice.paid", "sub_a", t0),
			result: Result{Step: Unrecoverable, Reason: "unknown_price"},
			want:   Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: NeedsAttention, Attempts: 1, LastError: "unknown_price", NextAttemptAt: t0, Alert: alert.Alert{State: alert.Pending, NextAttemptAt: now}},
			report: WorkerReport{NeedsAttention: 1},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := StoredTask{Scope: scopeOf("evt_1"), APIVersion: dahlia, Task: tc.task}
			store := newFakeTaskStore(ev)

			report := pass(t, store, &fakeHandler{result: tc.result}, now)

			if report != tc.report {
				t.Errorf("report = %+v, want %+v", report, tc.report)
			}
			if got := store.get(ev.Scope); got != tc.want {
				t.Errorf("task = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestWorkerRoutesWithoutTheHandlerWhenNoAdapterApplies(t *testing.T) {
	now := t0.Add(time.Second)
	t.Run("an unsupported event type is ignored with its reason", func(t *testing.T) {
		ev := newStored("evt_1", "customer.created", "")
		store := newFakeTaskStore(ev)
		h := &fakeHandler{result: Result{Step: Handled}}

		report := pass(t, store, h, now)

		if h.count() != 0 {
			t.Errorf("handler called %d times, want none", h.count())
		}
		got := store.get(ev.Scope)
		if report != (WorkerReport{Ignored: 1}) || got.Status != Ignored || got.LastError != ReasonUnsupportedEventType {
			t.Errorf("report = %+v, task = %+v; want ignored as %s", report, got, ReasonUnsupportedEventType)
		}
	})
	t.Run("a supported event of an unsupported API version needs attention with its alert", func(t *testing.T) {
		ev := newStored("evt_1", "invoice.paid", "sub_a")
		ev.APIVersion = "2025-01-01.acacia"
		store := newFakeTaskStore(ev)
		h := &fakeHandler{result: Result{Step: Handled}}

		report := pass(t, store, h, now)

		if h.count() != 0 {
			t.Errorf("handler called %d times, want none", h.count())
		}
		got := store.get(ev.Scope)
		if report != (WorkerReport{NeedsAttention: 1}) || got.Status != NeedsAttention || got.LastError != ReasonUnsupportedAPIVersion || got.Alert.State != alert.Pending {
			t.Errorf("report = %+v, task = %+v; want needs attention as %s with a pending alert", report, got, ReasonUnsupportedAPIVersion)
		}
	})
}

func TestWorkerLeavesTasksThatAreNotDue(t *testing.T) {
	now := t0.Add(time.Second)
	later := newStored("evt_later", "checkout.session.completed", "")
	later.Task = Task{Type: "checkout.session.completed", Status: Pending, Attempts: 1, NextAttemptAt: now.Add(time.Minute)}
	claimed := newStored("evt_claimed", "checkout.session.completed", "")
	claimed.Task = Task{Type: "checkout.session.completed", Status: Processing, NextAttemptAt: t0, ClaimToken: "other", ClaimExpiresAt: now.Add(time.Minute)}
	store := newFakeTaskStore(later, claimed)
	h := &fakeHandler{result: Result{Step: Handled}}

	report := pass(t, store, h, now)

	if h.count() != 0 || report != (WorkerReport{}) {
		t.Errorf("handler called %d times, report = %+v; want nothing handled", h.count(), report)
	}
	if store.get(later.Scope) != later.Task || store.get(claimed.Scope) != claimed.Task {
		t.Error("a task that was not due changed")
	}
}

func TestWorkerProcessesSubscriptionInvoicesWithoutALegacyBackfill(t *testing.T) {
	invoice := newStored("evt_invoice", "invoice.paid", "sub_a")
	store := newFakeTaskStore(invoice)
	h := &fakeHandler{result: Result{Step: Handled}}
	report := pass(t, store, h, t0)
	if report.Processed != 1 || store.get(invoice.Scope).Status != Processed {
		t.Fatalf("report = %+v, invoice = %+v", report, store.get(invoice.Scope))
	}
}

func TestWorkerSavesItsClaimBeforeHandling(t *testing.T) {
	ev := newStored("evt_1", "checkout.session.completed", "")
	store := newFakeTaskStore(ev)
	var during Task
	h := &fakeHandler{handle: func(context.Context, StoredTask) Result {
		during = store.get(ev.Scope)
		return Result{Step: Handled}
	}}

	pass(t, store, h, t0)

	if during.Status != Processing || during.ClaimToken == "" || during.ClaimExpiresAt != t0.Add(lease) {
		t.Errorf("task while handling = %+v, want claimed until %v", during, t0.Add(lease))
	}
}

func TestWorkerGivesTheHandlerItsOperationTimeout(t *testing.T) {
	ev := newStored("evt_1", "checkout.session.completed", "")
	store := newFakeTaskStore(ev)
	h := &fakeHandler{result: Result{Step: Handled}}
	start := time.Now()

	pass(t, store, h, t0)

	if h.count() != 1 {
		t.Fatalf("handler called %d times, want once", h.count())
	}
	deadline := h.calls[0].Deadline
	if deadline.IsZero() || deadline.Sub(start) > workerSettings.Timeout+time.Second {
		t.Errorf("handler deadline = %v, want about %v from the start", deadline, workerSettings.Timeout)
	}
}

func TestWorkerRecoversATaskWhoseClaimExpired(t *testing.T) {
	ev := newStored("evt_1", "checkout.session.completed", "")
	ev.Task = Task{Type: "checkout.session.completed", Status: Processing, NextAttemptAt: t0, ClaimToken: "crashed", ClaimExpiresAt: t0.Add(lease)}
	store := newFakeTaskStore(ev)
	h := &fakeHandler{result: Result{Step: Handled}}

	report := pass(t, store, h, t0.Add(lease))

	if report != (WorkerReport{Processed: 1}) || store.get(ev.Scope).Status != Processed {
		t.Errorf("report = %+v, task %q; want the crashed worker's task processed", report, store.get(ev.Scope).Status)
	}
}

func TestWorkerCommitsNothingAfterAnotherWorkerTookOverItsClaim(t *testing.T) {
	ev := newStored("evt_1", "invoice.paid", "sub_a")
	store := newFakeTaskStore(ev)
	h := &fakeHandler{handle: func(context.Context, StoredTask) Result {
		store.mu.Lock()
		cur := store.tasks[ev.Scope]
		cur.Task.ClaimToken = "other"
		store.tasks[ev.Scope] = cur
		store.mu.Unlock()
		return Result{Step: Handled, Effects: "grant"}
	}}

	report, err := NewWorker(store, h, workerSettings, clockAt(t0), workerTokens("w")).Pass(context.Background())

	if err != nil {
		t.Fatal(err)
	}
	if report != (WorkerReport{}) || store.appliedCount() != 0 {
		t.Errorf("report = %+v, applied %d effects; want nothing committed by the stale worker", report, store.appliedCount())
	}
	if got := store.get(ev.Scope); got.Status != Processing || got.ClaimToken != "other" {
		t.Errorf("task = %+v, want it left to the worker holding the claim", got)
	}
}

func TestWorkerKeepsAnAlertTheNotifierSentWhileItHandled(t *testing.T) {
	now := t0.Add(time.Second)
	raised := alert.Alert{State: alert.Pending, NextAttemptAt: t0}
	ev := newStored("evt_1", "invoice.paid", "sub_a")
	ev.Task = Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: NeedsAttention, Attempts: 1, LastError: "unknown_price", NextAttemptAt: t0, Alert: raised}
	retried, err := RetryByOperator(ev.Task, t0)
	if err != nil {
		t.Fatal(err)
	}
	ev.Task = retried
	store := newFakeTaskStore(ev)
	sent := alert.Alert{State: alert.Sent, Attempts: 1, SentAt: now}
	h := &fakeHandler{handle: func(context.Context, StoredTask) Result {
		store.mu.Lock()
		cur := store.tasks[ev.Scope]
		cur.Task.Alert = sent
		store.tasks[ev.Scope] = cur
		store.mu.Unlock()
		return Result{Step: Unrecoverable, Reason: "unknown_price"}
	}}

	report := pass(t, store, h, now)

	if report != (WorkerReport{NeedsAttention: 1}) {
		t.Errorf("report = %+v, want needs attention again", report)
	}
	if got := store.get(ev.Scope); got.Status != NeedsAttention || got.Alert != sent {
		t.Errorf("task = %+v, want needs attention with the alert still sent", got)
	}
}

func TestWorkerRequeuesWhenItsEffectsCannotCommit(t *testing.T) {
	ev := newStored("evt_1", "invoice.paid", "sub_a")
	store := newFakeTaskStore(ev)
	store.effectsErr = errors.New("acceptance revision changed")
	h := &fakeHandler{result: Result{Step: Handled, Effects: "accept sub_a"}}
	now := t0.Add(time.Second)

	report, err := NewWorker(store, h, workerSettings, clockAt(now), workerTokens("w")).Pass(context.Background())

	if err != nil {
		t.Fatal(err)
	}
	if report != (WorkerReport{Retried: 1}) || store.appliedCount() != 0 {
		t.Errorf("report = %+v, applied %d effects; want a retry with nothing applied", report, store.appliedCount())
	}
	want := Task{Type: "invoice.paid", SubscriptionID: "sub_a", Status: Pending, Attempts: 1, LastError: "acceptance revision changed", NextAttemptAt: now.Add(minDelay)}
	if got := store.get(ev.Scope); got != want {
		t.Errorf("task = %+v, want %+v", got, want)
	}
}

func TestWorkerReportsStorageFailures(t *testing.T) {
	t.Run("listing", func(t *testing.T) {
		store := newFakeTaskStore()
		store.listErr = errors.New("db down")
		if _, err := NewWorker(store, &fakeHandler{}, workerSettings, clockAt(t0), workerTokens("w")).Pass(context.Background()); !errors.Is(err, store.listErr) {
			t.Errorf("err = %v, want the listing error", err)
		}
	})
	t.Run("one task's save does not stop the others", func(t *testing.T) {
		broken := newStored("evt_broken", "checkout.session.completed", "")
		fine := newStored("evt_fine", "checkout.session.completed", "")
		store := newFakeTaskStore(broken, fine)
		saveErr := errors.New("db down")
		store.saveErr[broken.Scope] = saveErr

		report, err := NewWorker(store, &fakeHandler{result: Result{Step: Handled}}, workerSettings, clockAt(t0), workerTokens("w")).Pass(context.Background())

		if !errors.Is(err, saveErr) {
			t.Errorf("err = %v, want the save error", err)
		}
		if report != (WorkerReport{Processed: 1}) || store.get(fine.Scope).Status != Processed {
			t.Errorf("report = %+v, fine task %q; want it processed", report, store.get(fine.Scope).Status)
		}
	})
}

func TestParallelWorkersApplyEachEventOnce(t *testing.T) {
	var stored []StoredTask
	for i := range 20 {
		stored = append(stored, newStored(fmt.Sprintf("evt_%d", i), "invoice.paid", "sub_a"))
	}
	store := newFakeTaskStore(stored...)
	h := &fakeHandler{handle: func(_ context.Context, s StoredTask) Result {
		return Result{Step: Handled, Effects: s.Scope.EventID}
	}}

	var wg sync.WaitGroup
	for i := range 4 {
		w := NewWorker(store, h, workerSettings, clockAt(t0), workerTokens(fmt.Sprintf("w%d", i)))
		wg.Go(func() {
			if _, err := w.Pass(context.Background()); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()

	if store.appliedCount() != 20 || h.count() != 20 {
		t.Errorf("applied %d effects after %d handler calls, want each of the 20 events once", store.appliedCount(), h.count())
	}
}

func TestWorkerRunsAStartupPassThenAPassPerTick(t *testing.T) {
	ev := newStored("evt_1", "checkout.session.completed", "")
	ev.Task = Task{Type: "checkout.session.completed", Status: Pending, Attempts: 1, NextAttemptAt: t0.Add(minDelay)}
	store := newFakeTaskStore(ev)
	h := &fakeHandler{result: Result{Step: Handled}}
	clock := t0
	var mu sync.Mutex
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return clock
	}
	w := NewWorker(store, h, workerSettings, now, workerTokens("w"))

	ctx, cancel := context.WithCancel(context.Background())
	ticks := make(chan time.Time)
	passes := make(chan WorkerReport)
	done := make(chan struct{})
	go func() {
		w.Run(ctx, ticks, func(r WorkerReport, err error) {
			if err != nil {
				t.Error(err)
			}
			passes <- r
		})
		close(done)
	}()

	if r := <-passes; r != (WorkerReport{}) {
		t.Errorf("startup pass before the next attempt = %+v, want nothing", r)
	}

	mu.Lock()
	clock = t0.Add(minDelay)
	mu.Unlock()
	ticks <- clock
	if r := <-passes; r != (WorkerReport{Processed: 1}) {
		t.Errorf("pass at the next attempt = %+v, want 1 processed", r)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not stop when its context was cancelled")
	}
}

func TestWorkerStopsWhenItsTicksClose(t *testing.T) {
	store := newFakeTaskStore()
	w := NewWorker(store, &fakeHandler{}, workerSettings, clockAt(t0), workerTokens("w"))
	ticks := make(chan time.Time)
	close(ticks)
	var passes atomic.Int64
	done := make(chan struct{})
	go func() {
		w.Run(context.Background(), ticks, func(WorkerReport, error) { passes.Add(1) })
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("Run kept going after its ticks closed (%d passes)", passes.Load())
	}
	if passes.Load() != 1 {
		t.Errorf("passes = %d, want only the startup pass", passes.Load())
	}
}
