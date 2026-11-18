package worddef

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
)

// Call defines a single word with no sentence (ADR-045) on any provider.
// ParseResult is strict, because the reply can end up stored in the shared
// words table: a reply that does not pass is an error, and the tokens it
// used are still reported so the caller can bill them.
func Call(ctx context.Context, chat llm.Chat, word string) (Result, aiusage.Usage, error) {
	content, u, err := chat(ctx, "define_word", Temperature, SystemPrompt, BuildUserContent(word))
	if err != nil {
		return Result{}, u, err
	}
	res, err := ParseResult(content)
	if err != nil {
		return Result{}, u, err
	}
	return res, u, nil
}
