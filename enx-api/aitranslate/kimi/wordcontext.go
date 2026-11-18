package kimi

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/wordcontext"
)

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call; see wordcontext.Call.
func (k *Kimi) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	return wordcontext.Call(ctx, k.chatWith(k.model), sentence, word, dictionaryChinese)
}
