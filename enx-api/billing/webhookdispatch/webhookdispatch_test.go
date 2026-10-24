package webhookdispatch

import (
	"context"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	"enx-api/billing/chargerefunded"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/invoicepaid"
	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
)

// fakeKindHandler returns result and records the tasks it decided.
type fakeKindHandler struct {
	result webhookevent.Result
	tasks  []webhookevent.StoredTask
}

func (h *fakeKindHandler) Handle(_ context.Context, s webhookevent.StoredTask) webhookevent.Result {
	h.tasks = append(h.tasks, s)
	return h.result
}

type fakes struct {
	checkout, invoicePaid, refund, snapshot *fakeKindHandler
}

func newFakes() fakes {
	return fakes{
		checkout:    &fakeKindHandler{result: webhookevent.Result{Step: webhookevent.Handled, Effects: "checkout effects"}},
		invoicePaid: &fakeKindHandler{result: webhookevent.Result{Step: webhookevent.MissingDependency, Reason: "invoice_attribution_missing"}},
		refund:      &fakeKindHandler{result: webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: "refund_without_payment_intent"}},
		snapshot:    &fakeKindHandler{result: webhookevent.Result{Step: webhookevent.NoEffect, Reason: "no_subscription"}},
	}
}

func (f fakes) handlers() Handlers {
	return Handlers{Checkout: f.checkout, InvoicePaid: f.invoicePaid, Refund: f.refund, Snapshot: f.snapshot}
}

func newDispatcher(t *testing.T, h Handlers) *Dispatcher {
	t.Helper()
	d, err := New(h)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return d
}

var task = webhookevent.StoredTask{
	Scope:      webhookevent.Scope{AccountID: "acct_1", EventID: "evt_1"},
	APIVersion: "2026-08-26.dahlia",
	Task:       webhookevent.Task{Type: "invoice.paid", SubscriptionID: "sub_1", Status: webhookevent.Processing},
}

func TestEachBusinessKindGoesToItsOwnHandler(t *testing.T) {
	cases := []struct {
		kind webhookevent.Kind
		pick func(fakes) *fakeKindHandler
	}{
		{webhookevent.KindCheckout, func(f fakes) *fakeKindHandler { return f.checkout }},
		{webhookevent.KindInvoicePaid, func(f fakes) *fakeKindHandler { return f.invoicePaid }},
		{webhookevent.KindRefund, func(f fakes) *fakeKindHandler { return f.refund }},
		{webhookevent.KindSnapshot, func(f fakes) *fakeKindHandler { return f.snapshot }},
	}
	for _, c := range cases {
		t.Run(string(c.kind), func(t *testing.T) {
			f := newFakes()
			want := c.pick(f)

			got := newDispatcher(t, f.handlers()).Handle(context.Background(), c.kind, task)

			if !reflect.DeepEqual(got, want.result) {
				t.Errorf("result = %+v, want its handler's %+v", got, want.result)
			}
			for _, h := range []*fakeKindHandler{f.checkout, f.invoicePaid, f.refund, f.snapshot} {
				wantCalls := 0
				if h == want {
					wantCalls = 1
				}
				if len(h.tasks) != wantCalls {
					t.Errorf("a handler decided %d tasks, want %d", len(h.tasks), wantCalls)
				}
			}
			if len(want.tasks) == 1 && !reflect.DeepEqual(want.tasks[0], task) {
				t.Errorf("handler got task %+v, want %+v", want.tasks[0], task)
			}
		})
	}
}

func TestAKindWithNoHandlerNeedsAttention(t *testing.T) {
	for _, kind := range []webhookevent.Kind{webhookevent.KindIgnore, webhookevent.KindEscalate, "unknown"} {
		t.Run(string(kind), func(t *testing.T) {
			f := newFakes()

			got := newDispatcher(t, f.handlers()).Handle(context.Background(), kind, task)

			want := webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: ReasonNoHandler}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("result = %+v, want %+v", got, want)
			}
			if n := len(f.checkout.tasks) + len(f.invoicePaid.tasks) + len(f.refund.tasks) + len(f.snapshot.tasks); n != 0 {
				t.Errorf("handlers decided %d tasks, want 0", n)
			}
		})
	}
}

func TestEveryBusinessKindNeedsAHandler(t *testing.T) {
	cases := map[string]func(*Handlers){
		"checkout":     func(h *Handlers) { h.Checkout = nil },
		"invoice paid": func(h *Handlers) { h.InvoicePaid = nil },
		"refund":       func(h *Handlers) { h.Refund = nil },
		"snapshot":     func(h *Handlers) { h.Snapshot = nil },
	}
	for name, drop := range cases {
		t.Run(name, func(t *testing.T) {
			h := newFakes().handlers()
			drop(&h)
			if _, err := New(h); err == nil {
				t.Error("New without a handler returned no error")
			}
		})
	}
}

func TestTheDecisionServicesAreItsHandlers(t *testing.T) {
	_, err := New(Handlers{
		Checkout:    checkoutcompleted.NewHandler(nil, nil),
		InvoicePaid: invoicepaid.NewHandler(nil, nil, invoicepaid.Plans{}, time.Now),
		Refund:      chargerefunded.NewHandler(nil, nil),
		Snapshot:    snapshot.NewHandler(nil, nil, nil),
	})
	if err != nil {
		t.Errorf("New over the decision services: %v", err)
	}
}

// memoryTaskStore keeps tasks in memory with the conditional write a
// repository does, applying effects only when that write succeeds.
type memoryTaskStore struct {
	mu      sync.Mutex
	tasks   map[webhookevent.Scope]webhookevent.StoredTask
	applied []webhookevent.Effects
}

func (s *memoryTaskStore) Unfinished(context.Context) ([]webhookevent.StoredTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []webhookevent.StoredTask
	for _, st := range s.tasks {
		out = append(out, st)
	}
	return out, nil
}

func (s *memoryTaskStore) LegacyBackfillDone(context.Context) (bool, error) { return true, nil }

func (s *memoryTaskStore) Save(_ context.Context, scope webhookevent.Scope, read, next webhookevent.Task, effects webhookevent.Effects) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.tasks[scope]
	if cur.Task.Status != read.Status || cur.Task.Attempts != read.Attempts || cur.Task.ClaimToken != read.ClaimToken {
		return webhookevent.ErrStaleClaim
	}
	if effects != nil {
		s.applied = append(s.applied, effects)
	}
	cur.Task = next
	s.tasks[scope] = cur
	return nil
}

func TestTheWorkerCommitsTheEffectsOfTheRoutedHandler(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	scope := webhookevent.Scope{AccountID: "acct_1", EventID: "evt_checkout"}
	store := &memoryTaskStore{tasks: map[webhookevent.Scope]webhookevent.StoredTask{
		scope: {Scope: scope, APIVersion: "2026-08-26.dahlia", Task: webhookevent.NewTask("checkout.session.completed", "", now)},
	}}
	f := newFakes()
	tokens := 0
	worker := webhookevent.NewWorker(store, newDispatcher(t, f.handlers()), webhookevent.WorkerSettings{
		Timeout: 30 * time.Second, Lease: 2 * time.Minute,
		BackoffMin: 5 * time.Second, BackoffMax: 15 * time.Minute, DependencyWaitDeadline: 24 * time.Hour,
	}, func() time.Time { return now }, func() string { tokens++; return "token-" + strconv.Itoa(tokens) })

	report, err := worker.Pass(context.Background())

	if err != nil {
		t.Fatalf("Pass: %v", err)
	}
	if report.Processed != 1 {
		t.Errorf("report = %+v, want one processed event", report)
	}
	if want := []webhookevent.Effects{"checkout effects"}; !reflect.DeepEqual(store.applied, want) {
		t.Errorf("applied effects = %v, want %v", store.applied, want)
	}
	if got := store.tasks[scope].Task.Status; got != webhookevent.Processed {
		t.Errorf("task status = %q, want %q", got, webhookevent.Processed)
	}
}
