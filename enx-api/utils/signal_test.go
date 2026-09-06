package utils

import (
	"syscall"
	"testing"
	"time"
)

// TestWaitSignalsReturnsOnSIGTERM is the only test exercising WaitSignals:
// it calls signal.Stop on the shared channel once a signal is received, so a
// second call in this process would never see another signal and hang forever.
func TestWaitSignalsReturnsOnSIGTERM(t *testing.T) {
	go func() {
		time.Sleep(50 * time.Millisecond)
		if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
			t.Errorf("failed to send SIGTERM to self: %v", err)
		}
	}()

	done := make(chan struct{})
	go func() {
		WaitSignals()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("WaitSignals did not return after receiving SIGTERM")
	}
}
