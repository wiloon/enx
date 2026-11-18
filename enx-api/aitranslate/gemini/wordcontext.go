package gemini

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/wordcontext"
)

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call; see wordcontext.Call.
func (g *Gemini) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	return wordcontext.Call(ctx, g.chatWith(g.model), sentence, word, dictionaryChinese)
}
