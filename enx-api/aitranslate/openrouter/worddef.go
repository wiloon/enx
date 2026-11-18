package openrouter

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/worddef"
)

// DefineWord implements aitranslate.WordDefiner (ADR-045); see worddef.Call.
func (o *OpenRouter) DefineWord(ctx context.Context, word string) (worddef.Result, aiusage.Usage, error) {
	return worddef.Call(ctx, o.chatWith(o.model), word)
}
