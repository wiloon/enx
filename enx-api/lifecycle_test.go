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

func TestShutdownWaitsForMetricsRequest(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; w.WriteHeader(http.StatusOK) })}
	ctx, cancel := context.WithCancel(context.Background())
	tasks := newBackgroundTasks()
	tasks.start(func() { serveMetricsServer(ctx, srv, listener) })
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
	stopped := make(chan bool, 1)
	go func() { stopped <- tasks.wait(time.Second) }()
	select {
	case <-stopped:
		t.Fatal("shutdown returned before request drained")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-requestDone; err != nil {
		t.Fatal(err)
	}
	if !<-stopped {
		t.Fatal("shutdown timed out")
	}
}

func TestBackgroundShutdownHasDeadline(t *testing.T) {
	tasks := newBackgroundTasks()
	release := make(chan struct{})
	tasks.start(func() { <-release })
	defer close(release)
	if tasks.wait(20 * time.Millisecond) {
		t.Fatal("shutdown completed while work was still running")
	}
}
