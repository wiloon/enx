package main

import (
	"context"
	"net"
	"net/http"
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
	lifecycle, err := startBillingLifecycle(context.Background(), a)
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

// A worker can observe cancellation before it has finished its cleanup.
type drainingBillingAssembly struct {
	cancelled chan struct{}
	release   chan struct{}
	done      chan struct{}
}

func (a *drainingBillingAssembly) Start(ctx context.Context) error {
	go func() {
		<-ctx.Done()
		close(a.cancelled)
		<-a.release
		close(a.done)
	}()
	return nil
}
func (a *drainingBillingAssembly) Done() <-chan struct{} { return a.done }

func TestApplicationListenFailureCancelsAndJoinsBillingBeforeReturning(t *testing.T) {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	worker := &drainingBillingAssembly{cancelled: make(chan struct{}), release: make(chan struct{}), done: make(chan struct{})}
	defer close(worker.release)
	lifecycle, err := startBillingLifecycle(context.Background(), worker)
	if err != nil {
		t.Fatal(err)
	}
	a := &application{billing: lifecycle}
	result := make(chan error, 1)
	server := newServer(listener.Addr().String(), http.NewServeMux(), time.Second)
	go func() { result <- a.serve(context.Background(), server) }()
	select {
	case <-worker.cancelled:
	case <-time.After(time.Second):
		t.Fatal("listen failure did not cancel billing")
	}
	select {
	case err := <-result:
		t.Fatalf("returned before billing cleanup finished: %v", err)
	default:
	}
	worker.release <- struct{}{}
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("listen failure was swallowed")
		}
		select {
		case <-worker.done:
		default:
			t.Fatal("returned before worker Done")
		}
	case <-time.After(time.Second):
		t.Fatal("listen failure did not return after cleanup")
	}
}

func TestApplicationCancellationStopsServingAndBilling(t *testing.T) {
	worker := &testBillingAssembly{done: make(chan struct{})}
	lifecycle, err := startBillingLifecycle(context.Background(), worker)
	if err != nil {
		t.Fatal(err)
	}
	a := &application{billing: lifecycle}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := a.serve(ctx, newServer("127.0.0.1:0", http.NewServeMux(), time.Second)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-worker.done:
	default:
		t.Fatal("application returned with billing still running")
	}
}
