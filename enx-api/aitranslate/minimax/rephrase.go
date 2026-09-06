package minimax

import (
	"context"

	"enx-api/aitranslate/rephrase"
)

// Rephrase implements rephrase.Rephraser against MiniMax's chat API (ADR-012).
// homelab runs the MiniMax provider, so without this method the rephrase
// endpoint would be unavailable there. The model is prompted to return JSON;
// rephrase.ParseResult is lenient about fences and stray prose. Token usage
// from the API response is attached so the caller bills by actual
// consumption (ADR-012 Decision 5). Prompt and temperature are shared
// across providers -- see the rephrase package.
func (m *MiniMax) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	content, u, err := m.chat(ctx, "rephrase_to_english", rephrase.Temperature, rephrase.SystemPrompt, input)
	if err != nil {
		return rephrase.Result{}, err
	}

	result, err := rephrase.ParseResult(content)
	if err != nil {
		return rephrase.Result{}, err
	}

	result.Usage = rephrase.Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
	return result, nil
}
