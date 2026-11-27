package aitranslate

import (
	"context"
	"testing"
	"time"

	"enx-api/aitranslate/llm/llmtest"
)

type observed struct {
	provider, operation string
	err                 error
	in, out             int
}

type fakeObserver struct{ calls []observed }

func (f *fakeObserver) ObserveAI(provider, operation string, _ time.Time, err error, in, out int) {
	f.calls = append(f.calls, observed{provider, operation, err, in, out})
}

// router.go instruments one provider for the handler and the word definer and
// another for rephrase; neither may change the provider it was given.
func TestInstrumentLeavesItsInputUnobserved(t *testing.T) {
	obs := &fakeObserver{}
	plain := &Provider{Chat: (&llmtest.Fake{Reply: "x"}).Chat, DefinesWords: true}

	Instrument(plain, "deepseek", obs)
	definer, ok := AsWordDefiner(plain)
	if !ok {
		t.Fatal("want a definer")
	}
	_, _, _ = definer.DefineWord(context.Background(), "rizzler")

	if len(obs.calls) != 0 {
		t.Errorf("observed %+v, want nothing", obs.calls)
	}
}
