package deepseek

import (
	"context"

	"enx-api/aitranslate/rephrase"
)

// Rephrase implements rephrase.Rephraser (ADR-012) on the rephrase model;
// see rephrase.Call.
func (d *DeepSeek) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	return rephrase.Call(ctx, d.chatWith(d.modelForRephrase()), input)
}
