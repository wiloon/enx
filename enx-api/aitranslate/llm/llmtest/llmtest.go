// Package llmtest provides a fake llm.Chat for the feature packages' tests.
package llmtest

import (
	"context"

	"enx-api/aitranslate/aiusage"
)

// Call is one prompt the fake received.
type Call struct {
	Feature     string
	Temperature float64
	System      string
	User        string
}

// Fake answers every prompt with Reply, Usage and Err, and records it.
type Fake struct {
	Reply string
	Usage aiusage.Usage
	Err   error
	Calls []Call
}

// Chat has llm.Chat's signature; pass f.Chat where an llm.Chat is wanted.
func (f *Fake) Chat(_ context.Context, feature string, temperature float64, system, user string) (string, aiusage.Usage, error) {
	f.Calls = append(f.Calls, Call{Feature: feature, Temperature: temperature, System: system, User: user})
	return f.Reply, f.Usage, f.Err
}
