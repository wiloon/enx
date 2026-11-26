package rephrase

import (
	"context"

	"enx-api/aitranslate/llm"
)

// Call rephrases input on any provider (ADR-012). The model is prompted to
// return JSON; ParseResult is lenient about fences and stray prose. The
// token usage is attached to the Result so the caller can bill by actual
// consumption (ADR-012 Decision 5); a failed call returns a Result holding
// only the Usage, so it can be billed too (ADR-094).
func Call(ctx context.Context, chat llm.Chat, input string) (Result, error) {
	content, u, err := chat(ctx, "rephrase_to_english", Temperature, SystemPrompt, input)
	usage := Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
	if err != nil {
		return Result{Usage: usage}, err
	}
	result, err := ParseResult(content)
	if err != nil {
		return Result{Usage: usage}, err
	}
	result.Usage = usage
	return result, nil
}
