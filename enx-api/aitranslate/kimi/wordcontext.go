package kimi

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/wordcontext"
)

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call: one Kimi request returns the target word's in-context
// meaning plus (when a dictionary definition was supplied and the meanings
// diverge) a short explanation why, as JSON. wordcontext.ParseResult is
// lenient about fences and stray prose; a missing why is tolerated, a
// missing word gloss is an error.
func (k *Kimi) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	content, u, err := k.chat(
		ctx,
		"translate_word_in_context",
		k.model,
		wordcontext.Temperature,
		wordcontext.SystemPrompt,
		wordcontext.BuildUserContent(sentence, word, dictionaryChinese),
	)
	if err != nil {
		return wordcontext.Result{}, toUsage(u), err
	}

	res, err := wordcontext.ParseResult(content)
	if err != nil {
		return wordcontext.Result{}, toUsage(u), err
	}
	return res, toUsage(u), nil
}
