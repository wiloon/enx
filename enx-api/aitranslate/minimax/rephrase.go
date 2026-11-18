package minimax

import (
	"context"

	"enx-api/aitranslate/rephrase"
)

// Rephrase implements rephrase.Rephraser (ADR-012); see rephrase.Call.
// homelab runs the MiniMax provider, so without this method the rephrase
// endpoint would be unavailable there.
func (m *MiniMax) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	return rephrase.Call(ctx, m.chat, input)
}
