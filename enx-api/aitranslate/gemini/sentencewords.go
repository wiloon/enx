package gemini

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/sentenceword"
)

// TranslateSentenceWithWords implements aitranslate.Translator's multi-word
// combined call (ADR-023 Decision 9); see sentenceword.CallWords.
func (g *Gemini) TranslateSentenceWithWords(ctx context.Context, sentence string, words []sentenceword.WordInput) (sentenceword.WordsResult, aiusage.Usage, error) {
	return sentenceword.CallWords(ctx, g.chatWith(g.model), sentence, words)
}
