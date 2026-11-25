package aitranslate

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"enx-api/aitranslate/rephrase"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
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

type stubTranslator struct {
	usage Usage
	err   error
}

func (f stubTranslator) TranslateSentence(context.Context, string) (string, Usage, error) {
	return "译文", f.usage, f.err
}
func (f stubTranslator) TranslateWordInContext(context.Context, string, string, string) (wordcontext.Result, Usage, error) {
	return wordcontext.Result{WordChinese: "跑"}, f.usage, f.err
}
func (f stubTranslator) TranslateSentenceWithWords(context.Context, string, []sentenceword.WordInput) (sentenceword.WordsResult, Usage, error) {
	return sentenceword.WordsResult{
		SentenceChinese: "句",
		Words:           []sentenceword.WordGloss{{Word: "run", Chinese: "跑"}},
	}, f.usage, f.err
}

type stubRephraser struct {
	res rephrase.Result
	err error
}

func (f stubRephraser) Rephrase(context.Context, string) (rephrase.Result, error) {
	return f.res, f.err
}

func TestInstrumentRecordsEveryTranslatorCall(t *testing.T) {
	obs := &fakeObserver{}
	tr := Instrument(stubTranslator{usage: Usage{PromptTokens: 100, CompletionTokens: 20}}, "bedrock", obs)
	ctx := context.Background()

	if out, _, err := tr.TranslateSentence(ctx, "s"); out != "译文" || err != nil {
		t.Fatalf("TranslateSentence passthrough: %q, %v", out, err)
	}
	if res, _, _ := tr.TranslateWordInContext(ctx, "s", "w", ""); res.WordChinese != "跑" {
		t.Fatalf("TranslateWordInContext passthrough: %+v", res)
	}
	res, usage, err := tr.TranslateSentenceWithWords(ctx, "s", []sentenceword.WordInput{{Word: "run"}})
	wantGlosses := []sentenceword.WordGloss{{Word: "run", Chinese: "跑"}}
	if err != nil || res.SentenceChinese != "句" || !slices.Equal(res.Words, wantGlosses) ||
		usage != (Usage{PromptTokens: 100, CompletionTokens: 20}) {
		t.Fatalf("TranslateSentenceWithWords passthrough: result=%+v usage=%+v error=%v", res, usage, err)
	}

	want := []observed{
		{"bedrock", "translate_sentence", nil, 100, 20},
		{"bedrock", "word_in_context", nil, 100, 20},
		{"bedrock", "sentence_with_words", nil, 100, 20},
	}
	if len(obs.calls) != len(want) {
		t.Fatalf("observed %d calls, want %d", len(obs.calls), len(want))
	}
	for i := range want {
		if obs.calls[i] != want[i] {
			t.Errorf("call %d = %+v, want %+v", i, obs.calls[i], want[i])
		}
	}
}

func TestInstrumentPassesErrorsThrough(t *testing.T) {
	obs := &fakeObserver{}
	boom := errors.New("provider down")
	tr := Instrument(stubTranslator{err: boom}, "kimi", obs)

	if _, _, err := tr.TranslateSentence(context.Background(), "s"); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the provider's error", err)
	}
	if len(obs.calls) != 1 || !errors.Is(obs.calls[0].err, boom) {
		t.Fatalf("observed %+v, want the error recorded", obs.calls)
	}
}

func TestInstrumentRephraser(t *testing.T) {
	obs := &fakeObserver{}
	r := InstrumentRephraser(stubRephraser{res: rephrase.Result{Idiomatic: "x", Usage: rephrase.Usage{PromptTokens: 7, CompletionTokens: 3}}}, "gemini", obs)

	res, err := r.Rephrase(context.Background(), "in")
	if err != nil || res.Idiomatic != "x" {
		t.Fatalf("passthrough: %+v, %v", res, err)
	}
	if len(obs.calls) != 1 || obs.calls[0] != (observed{"gemini", "rephrase", nil, 7, 3}) {
		t.Fatalf("observed %+v", obs.calls)
	}
}
