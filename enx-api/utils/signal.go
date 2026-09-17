package utils

import (
	"os"
	"os/signal"
	"syscall"
)

// signals must be buffered: signal.Notify never blocks, so a signal arriving
// while nobody is receiving on an unbuffered channel is silently dropped and
// graceful shutdown would be missed.
var signals = make(chan os.Signal, 1)

func init() {
	// os.Kill (SIGKILL) is intentionally not registered: it cannot be caught
	// or handled by a Go program.
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
}

// WaitSignals blocks until the process receives SIGINT or SIGTERM, then stops
// delivery on the channel. Notify only sends the registered signals, so any
// received value is a shutdown request.
func WaitSignals() {
	<-signals
	signal.Stop(signals)
}
