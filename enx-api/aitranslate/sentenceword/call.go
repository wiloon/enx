package sentenceword

import (
	"context"
	"fmt"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
)

// Call is the combined sentence-and-word translation (ADR-014) on any
// provider: one prompt returns both the whole-sentence translation and the
// target word's in-context meaning as JSON. ParseResult is lenient about
// fences and stray prose; a missing word gloss is tolerated (empty
// Result.WordChinese), a missing sentence translation is an error. The
// usage is returned on every path so the caller bills by actual
// consumption.
func Call(ctx context.Context, chat llm.Chat, sentence, word string) (Result, aiusage.Usage, error) {
	content, u, err := chat(ctx, "translate_sentence_with_word", Temperature, SystemPrompt,
		fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word))
	if err != nil {
		return Result{}, u, err
	}
	res, err := ParseResult(content)
	if err != nil {
		return Result{}, u, err
	}
	return res, u, nil
}
