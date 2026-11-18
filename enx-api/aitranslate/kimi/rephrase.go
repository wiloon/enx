package kimi

import (
	"context"

	"enx-api/aitranslate/rephrase"
)

// Rephrase implements rephrase.Rephraser (ADR-012) on the rephrase model;
// see rephrase.Call.
func (k *Kimi) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	return rephrase.Call(ctx, k.chatWith(k.modelForRephrase()), input)
}
