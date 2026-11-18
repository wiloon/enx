package openrouter

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/sentenceword"
)

// TranslateSentenceWithWord implements aitranslate.Translator's combined
// call (ADR-014); see sentenceword.Call.
func (o *OpenRouter) TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, aiusage.Usage, error) {
	return sentenceword.Call(ctx, o.chatWith(o.model), sentence, word)
}
