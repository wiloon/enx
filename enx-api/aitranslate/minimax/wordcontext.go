package minimax

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/wordcontext"
)

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call; see wordcontext.Call. A reply that does not parse is
// asked for again once (see retryParse).
func (m *MiniMax) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	return retryParse(ctx, m.chat, func(ctx context.Context, chat llm.Chat) (wordcontext.Result, aiusage.Usage, error) {
		return wordcontext.Call(ctx, chat, sentence, word, dictionaryChinese)
	})
}
