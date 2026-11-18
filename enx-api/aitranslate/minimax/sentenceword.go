package minimax

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/sentenceword"
)

// TranslateSentenceWithWord implements aitranslate.Translator's combined
// call (ADR-014); see sentenceword.Call. A reply that does not parse is
// asked for again once (see retryParse).
func (m *MiniMax) TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, aiusage.Usage, error) {
	return retryParse(ctx, m.chat, func(ctx context.Context, chat llm.Chat) (sentenceword.Result, aiusage.Usage, error) {
		return sentenceword.Call(ctx, chat, sentence, word)
	})
}
