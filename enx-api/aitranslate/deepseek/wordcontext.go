package deepseek

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/wordcontext"
)

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call; see wordcontext.Call.
func (d *DeepSeek) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	return wordcontext.Call(ctx, d.chatWith(d.model), sentence, word, dictionaryChinese)
}
