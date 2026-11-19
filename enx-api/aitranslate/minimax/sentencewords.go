package minimax

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/sentenceword"
)

// TranslateSentenceWithWords implements aitranslate.Translator's multi-word
// combined call (ADR-023 Decision 9); see sentenceword.CallWords. A reply that
// does not parse is asked for again once (see retryParse).
func (m *MiniMax) TranslateSentenceWithWords(ctx context.Context, sentence string, words []sentenceword.WordInput) (sentenceword.WordsResult, aiusage.Usage, error) {
	return retryParse(ctx, m.chat, func(ctx context.Context, chat llm.Chat) (sentenceword.WordsResult, aiusage.Usage, error) {
		return sentenceword.CallWords(ctx, chat, sentence, words)
	})
}
