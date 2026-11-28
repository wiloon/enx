package wordeng

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
)

// Call defines a single word in English with no sentence (ADR-098) on any
// provider. ParseResult is strict, because the reply can end up stored in the
// shared AI English table: a reply that does not pass is an error, and the
// tokens it used are still reported so the caller can bill them.
func Call(ctx context.Context, chat llm.Chat, word string) (Result, aiusage.Usage, error) {
	content, u, err := chat(ctx, "define_word_en", Temperature, SystemPrompt, BuildUserContent(word))
	if err != nil {
		return Result{}, u, err
	}
	res, err := ParseResult(content)
	if err != nil {
		return Result{}, u, err
	}
	return res, u, nil
}
