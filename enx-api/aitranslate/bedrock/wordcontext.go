package bedrock

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/wordcontext"
)

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call; see wordcontext.Call.
func (b *Bedrock) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	return wordcontext.Call(ctx, b.chat, sentence, word, dictionaryChinese)
}
