package deepseek

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/worddef"
)

// DefineWord implements aitranslate.WordDefiner (ADR-045); see worddef.Call.
func (d *DeepSeek) DefineWord(ctx context.Context, word string) (worddef.Result, aiusage.Usage, error) {
	return worddef.Call(ctx, d.chatWith(d.model), word)
}
