package aitranslate

import (
	"context"
	"time"

	"enx-api/aitranslate/worddef"
)

// WordDefiner defines one English word with no sentence (ADR-045's AI word
// fallback). It is optional: a provider adds DefineWord when it supports it,
// instead of every provider being forced to (the Translator interface is
// shared by all of them). Use AsWordDefiner to ask a Translator for it.
type WordDefiner interface {
	DefineWord(ctx context.Context, word string) (worddef.Result, Usage, error)
}

// AsWordDefiner returns t's word definer, or false when its provider does not
// support defining a word. It sees through Instrument, which wraps a
// Translator and would otherwise hide the capability behind its own type.
func AsWordDefiner(t Translator) (WordDefiner, bool) {
	if i, ok := t.(*instrumentedTranslator); ok {
		inner, ok := i.next.(WordDefiner)
		if !ok {
			return nil, false
		}
		return &instrumentedDefiner{next: inner, provider: i.provider, obs: i.obs}, true
	}
	d, ok := t.(WordDefiner)
	return d, ok
}

// instrumentedDefiner times and counts DefineWord calls as operation
// "define_word", like the Translator wrapper does for its methods.
type instrumentedDefiner struct {
	next     WordDefiner
	provider string
	obs      AIObserver
}

func (i *instrumentedDefiner) DefineWord(ctx context.Context, word string) (worddef.Result, Usage, error) {
	start := time.Now()
	res, u, err := i.next.DefineWord(ctx, word)
	i.obs.ObserveAI(i.provider, "define_word", start, err, u.PromptTokens, u.CompletionTokens)
	return res, u, err
}
