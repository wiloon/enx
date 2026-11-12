package main

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestPeriodicWorkStartsImmediatelyAndStopsWhenIdle(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{}, 1)
	done := make(chan struct{})
	go func() { runPeriodic(ctx, time.Hour, func(context.Context) { started <- struct{}{} }); close(done) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("work did not start immediately")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("idle worker did not stop")
	}
}

func TestPeriodicWorkReceivesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	done := make(chan struct{})
	go func() {
		runPeriodic(ctx, time.Hour, func(ctx context.Context) { close(started); <-ctx.Done() })
		close(done)
	}()
	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("in-flight work did not receive cancellation")
	}
}

// TestServeUntilStoppedJoinsBackgroundWork pins the shutdown wiring in main:
// after serve returns, the process must not return until the workers have
// stopped. Deleting the join makes this test fail on the first select.
func TestServeUntilStoppedJoinsBackgroundWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	work := &backgroundTasks{}
	release := make(chan struct{})
	t.Cleanup(func() { closeIfOpen(release) })
	worked := make(chan struct{})
	work.start("blocking job", func() { <-ctx.Done(); <-release; close(worked) })

	returned := make(chan bool, 1)
	go func() {
		serveErr, drained := serveUntilStopped(cancel, time.Minute, work, func() error { return nil })
		if serveErr != nil {
			t.Errorf("serve error: %v", serveErr)
		}
		returned <- drained
	}()

	select {
	case <-returned:
		t.Fatal("serveUntilStopped returned while background work was still running")
	case <-time.After(100 * time.Millisecond):
	}

	close(release)
	select {
	case <-worked:
	case <-time.After(time.Second):
		t.Fatal("background work did not finish")
	}
	select {
	case drained := <-returned:
		if !drained {
			t.Fatal("shutdown reported a timeout")
		}
	case <-time.After(time.Second):
		t.Fatal("serveUntilStopped did not return")
	}
}

func TestBackgroundShutdownHasDeadline(t *testing.T) {
	work := &backgroundTasks{}
	release := make(chan struct{})
	t.Cleanup(func() { closeIfOpen(release) })
	work.start("stuck job", func() { <-release })
	if work.wait(20 * time.Millisecond) {
		t.Fatal("shutdown completed while work was still running")
	}
	if got := work.stillRunning(); len(got) != 1 || got[0] != "stuck job" {
		t.Fatalf("stillRunning() = %v, want [stuck job]", got)
	}
}

func TestMetricsShutdownDrainsActiveRequest(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { closeIfOpen(release) })
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusOK)
	})}
	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan struct{})
	go func() {
		serveMetricsServer(ctx, "test", srv, listener)
		close(served)
	}()

	requestDone := make(chan error, 1)
	go func() {
		resp, err := http.Get("http://" + listener.Addr().String())
		if err == nil {
			err = resp.Body.Close()
		}
		requestDone <- err
	}()
	<-entered
	cancel()

	select {
	case <-served:
		t.Fatal("metrics shutdown returned before the request drained")
	case <-time.After(100 * time.Millisecond):
	}

	close(release)
	if err := <-requestDone; err != nil {
		t.Fatal(err)
	}
	select {
	case <-served:
	case <-time.After(time.Second):
		t.Fatal("metrics shutdown did not return after the request drained")
	}
}

// closeIfOpen closes c unless it is already closed, so test cleanup never
// panics on a release channel the test already closed.
func closeIfOpen(c chan struct{}) {
	select {
	case <-c:
	default:
		close(c)
	}
}
