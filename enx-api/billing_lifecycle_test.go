package main

import (
	"context"
	"testing"
	"time"
)

type testBillingAssembly struct {
	done   chan struct{}
	starts int
}

func (a *testBillingAssembly) Start(ctx context.Context) error {
	a.starts++
	go func() { <-ctx.Done(); close(a.done) }()
	return nil
}
func (a *testBillingAssembly) Done() <-chan struct{} { return a.done }

func TestBillingLifecycleCancelsAndWaitsForAssembly(t *testing.T) {
	a := &testBillingAssembly{done: make(chan struct{})}
	lifecycle, err := startBillingLifecycle(a)
	if err != nil {
		t.Fatal(err)
	}
	if a.starts != 1 {
		t.Fatalf("started %d times", a.starts)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := lifecycle.stop(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-a.done:
	default:
		t.Fatal("assembly still running")
	}
}

func TestBillingLifecycleStopsWaitingAtDeadline(t *testing.T) {
	a := &testBillingAssembly{done: make(chan struct{})}
	lifecycle := &billingLifecycle{cancel: func() {}, done: a.done}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := lifecycle.stop(ctx); err != context.Canceled {
		t.Fatalf("got %v, want context cancellation", err)
	}
}
