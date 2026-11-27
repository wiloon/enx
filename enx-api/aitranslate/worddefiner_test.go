package aitranslate

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/llm/llmtest"
)

func TestAsWordDefinerSeesWhetherTheProviderSupportsIt(t *testing.T) {
	if _, ok := AsWordDefiner(nil); ok {
		t.Error("an unconfigured provider must not be offered as a definer")
	}
	if _, ok := AsWordDefiner(&Provider{}); ok {
		t.Error("a provider without DefinesWords must not be offered as a definer")
	}
	if _, ok := AsWordDefiner(&Provider{DefinesWords: true}); !ok {
		t.Error("a provider with DefinesWords should be offered as a definer")
	}
}

func TestWordDefinerRecordsFailures(t *testing.T) {
	obs := &fakeObserver{}
	boom := errors.New("provider down")
	p := &Provider{Chat: (&llmtest.Fake{Err: boom}).Chat, DefinesWords: true}
	definer, _ := AsWordDefiner(Instrument(p, "openrouter", obs))

	if _, _, err := definer.DefineWord(context.Background(), "rizzler"); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the provider error", err)
	}
	if len(obs.calls) != 1 || obs.calls[0].operation != "define_word" || !errors.Is(obs.calls[0].err, boom) {
		t.Fatalf("observed %+v, want the failure recorded", obs.calls)
	}
}
