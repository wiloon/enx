package aitranslate

import (
	"context"
	"time"

	"enx-api/aitranslate/rephrase"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
)

// AIObserver records one AI provider call: metrics.Metrics in production
// (ADR-040).
type AIObserver interface {
	ObserveAI(provider, operation string, start time.Time, err error, inputTokens, outputTokens int)
}

// Instrument wraps t so every call is timed and its tokens counted under
// provider. The provider implementations stay untouched.
func Instrument(t Translator, provider string, obs AIObserver) Translator {
	return &instrumentedTranslator{next: t, provider: provider, obs: obs}
}

type instrumentedTranslator struct {
	next     Translator
	provider string
	obs      AIObserver
}

func (i *instrumentedTranslator) observe(operation string, start time.Time, u Usage, err error) {
	i.obs.ObserveAI(i.provider, operation, start, err, u.PromptTokens, u.CompletionTokens)
}

func (i *instrumentedTranslator) TranslateSentence(ctx context.Context, sentence string) (string, Usage, error) {
	start := time.Now()
	out, u, err := i.next.TranslateSentence(ctx, sentence)
	i.observe("translate_sentence", start, u, err)
	return out, u, err
}

func (i *instrumentedTranslator) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, Usage, error) {
	start := time.Now()
	res, u, err := i.next.TranslateWordInContext(ctx, sentence, word, dictionaryChinese)
	i.observe("word_in_context", start, u, err)
	return res, u, err
}

func (i *instrumentedTranslator) TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, Usage, error) {
	start := time.Now()
	res, u, err := i.next.TranslateSentenceWithWord(ctx, sentence, word)
	i.observe("sentence_with_word", start, u, err)
	return res, u, err
}

// InstrumentRephraser wraps r the same way, as operation "rephrase".
func InstrumentRephraser(r rephrase.Rephraser, provider string, obs AIObserver) rephrase.Rephraser {
	return &instrumentedRephraser{next: r, provider: provider, obs: obs}
}

type instrumentedRephraser struct {
	next     rephrase.Rephraser
	provider string
	obs      AIObserver
}

func (i *instrumentedRephraser) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	start := time.Now()
	res, err := i.next.Rephrase(ctx, input)
	i.obs.ObserveAI(i.provider, "rephrase", start, err, res.Usage.PromptTokens, res.Usage.CompletionTokens)
	return res, err
}
