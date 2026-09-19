package gemini

import (
	"context"

	"enx-api/aitranslate/rephrase"
)

// Rephrase implements rephrase.Rephraser against Gemini's OpenAI-compatible
// chat API. The model is prompted to return JSON; rephrase.ParseResult is
// lenient about fences and stray prose. Token usage from the API response
// is attached so the caller can bill by actual consumption (ADR-012
// Decision 5). The prompt and temperature are shared across providers --
// see the rephrase package.
func (g *Gemini) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	content, u, err := g.chat(ctx, "rephrase_to_english", g.modelForRephrase(), rephrase.Temperature, rephrase.SystemPrompt, input)
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
