package aitranslate

import (
	"context"

	"enx-api/aitranslate/worddef"
	"enx-api/aitranslate/wordeng"
)

// WordDefiner defines one English word with no sentence (ADR-045's AI word
// fallback). It is optional: only a provider with DefinesWords serves it.
// Use AsWordDefiner to ask a Provider for it.
type WordDefiner interface {
	DefineWord(ctx context.Context, word string) (worddef.Result, Usage, error)
}

// EnglishWordDefiner defines one English word in English with no sentence
// (ADR-098 Decision 5). Same providers as WordDefiner.
type EnglishWordDefiner interface {
	DefineEnglishWord(ctx context.Context, word string) (wordeng.Result, Usage, error)
}

// AsWordDefiner returns p's word definer, or false when there is no provider
// or it does not serve define-word.
func AsWordDefiner(p *Provider) (WordDefiner, bool) {
	if p == nil || !p.DefinesWords {
		return nil, false
	}
	return providerDefiner{p}, true
}

// AsEnglishWordDefiner returns p's English-English word definer, or false when
// there is no provider or it does not serve define-word.
func AsEnglishWordDefiner(p *Provider) (EnglishWordDefiner, bool) {
	if p == nil || !p.DefinesWords {
		return nil, false
	}
	return providerEnglishDefiner{p}, true
}

type providerDefiner struct{ provider *Provider }

func (d providerDefiner) DefineWord(ctx context.Context, word string) (worddef.Result, Usage, error) {
	return observe(d.provider, "define_word", func() (worddef.Result, Usage, error) {
		return worddef.Call(ctx, d.provider.Chat, word)
	})
}

type providerEnglishDefiner struct{ provider *Provider }

func (d providerEnglishDefiner) DefineEnglishWord(ctx context.Context, word string) (wordeng.Result, Usage, error) {
	return observe(d.provider, "define_word_en", func() (wordeng.Result, Usage, error) {
		return wordeng.Call(ctx, d.provider.Chat, word)
	})
}
