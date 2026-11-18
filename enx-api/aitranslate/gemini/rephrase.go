package gemini

import (
	"context"

	"enx-api/aitranslate/rephrase"
)

// Rephrase implements rephrase.Rephraser (ADR-012) on the rephrase model;
// see rephrase.Call.
func (g *Gemini) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	return rephrase.Call(ctx, g.chatWith(g.modelForRephrase()), input)
}
