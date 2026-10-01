package aitranslate

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/worddef"
)

// definingTranslator is a stubTranslator whose provider also defines words.
type definingTranslator struct {
	stubTranslator
	res worddef.Result
}

func (f definingTranslator) DefineWord(context.Context, string) (worddef.Result, Usage, error) {
	return f.res, f.usage, f.err
}

func TestAsWordDefinerSeesWhetherTheProviderSupportsIt(t *testing.T) {
	if _, ok := AsWordDefiner(stubTranslator{}); ok {
		t.Fatal("a provider without DefineWord must not be offered as a definer")
	}
	if _, ok := AsWordDefiner(definingTranslator{}); !ok {
		t.Fatal("a provider with DefineWord should be offered as a definer")
	}
}

// Instrument wraps the Translator in its own type; the capability must
// survive the wrapping, or the metrics wrapper would silently switch the
// feature off.
func TestAsWordDefinerSeesThroughInstrument(t *testing.T) {
	obs := &fakeObserver{}

	if _, ok := AsWordDefiner(Instrument(stubTranslator{}, "deepseek", obs)); ok {
		t.Fatal("instrumenting a provider without DefineWord must not invent the capability")
	}

	want := worddef.Result{IsWord: true, Quality: 9}
	inner := definingTranslator{stubTranslator: stubTranslator{usage: Usage{PromptTokens: 150, CompletionTokens: 40}}, res: want}
	definer, ok := AsWordDefiner(Instrument(inner, "deepseek", obs))
	if !ok {
		t.Fatal("instrumenting a provider with DefineWord must keep the capability")
	}
	got, u, err := definer.DefineWord(context.Background(), "rizzler")
	if err != nil || got.Quality != want.Quality || u.PromptTokens != 150 {
		t.Fatalf("got %+v, %+v, %v", got, u, err)
	}
	if len(obs.calls) != 1 || obs.calls[0].operation != "define_word" || obs.calls[0].provider != "deepseek" ||
		obs.calls[0].in != 150 || obs.calls[0].out != 40 {
		t.Fatalf("observed %+v, want one define_word call with its tokens", obs.calls)
	}
}

func TestInstrumentedDefinerRecordsFailures(t *testing.T) {
	obs := &fakeObserver{}
	boom := errors.New("provider down")
	inner := definingTranslator{stubTranslator: stubTranslator{err: boom}}
	definer, _ := AsWordDefiner(Instrument(inner, "openrouter", obs))

	if _, _, err := definer.DefineWord(context.Background(), "rizzler"); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the provider error", err)
	}
	if len(obs.calls) != 1 || !errors.Is(obs.calls[0].err, boom) {
		t.Fatalf("observed %+v, want the failure recorded", obs.calls)
	}
}
