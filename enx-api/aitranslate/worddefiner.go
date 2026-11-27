package aitranslate

import (
	"context"

	"enx-api/aitranslate/worddef"
)

// WordDefiner defines one English word with no sentence (ADR-045's AI word
// fallback). It is optional: only a provider with DefinesWords serves it.
// Use AsWordDefiner to ask a Provider for it.
type WordDefiner interface {
	DefineWord(ctx context.Context, word string) (worddef.Result, Usage, error)
}

// AsWordDefiner returns p's word definer, or false when there is no provider
// or it does not serve define-word.
func AsWordDefiner(p *Provider) (WordDefiner, bool) {
	if p == nil || !p.DefinesWords {
		return nil, false
	}
	return providerDefiner{p}, true
}

type providerDefiner struct{ provider *Provider }

func (d providerDefiner) DefineWord(ctx context.Context, word string) (worddef.Result, Usage, error) {
	return observe(d.provider, "define_word", func() (worddef.Result, Usage, error) {
		return worddef.Call(ctx, d.provider.Chat, word)
	})
}
