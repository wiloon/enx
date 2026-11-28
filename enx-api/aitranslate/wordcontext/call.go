package wordcontext

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
)

// Call is the dictionary-first word gloss on any provider: one prompt
// returns the target word's in-context meaning plus (when a dictionary
// definition was supplied and the meanings diverge) a short explanation
// why, as JSON. ParseResult is lenient about fences and stray prose; a
// missing why is tolerated, a missing word gloss is an error. The usage is
// returned on every path so the caller bills by actual consumption.
func Call(ctx context.Context, chat llm.Chat, sentence, word, definition string) (Result, aiusage.Usage, error) {
	return call(ctx, chat, SystemPrompt, sentence, word, definition)
}

// CallEnglish is Call with the gloss and its why in plain English.
func CallEnglish(ctx context.Context, chat llm.Chat, sentence, word, definition string) (Result, aiusage.Usage, error) {
	return call(ctx, chat, EnglishSystemPrompt, sentence, word, definition)
}

func call(ctx context.Context, chat llm.Chat, system, sentence, word, definition string) (Result, aiusage.Usage, error) {
	content, u, err := chat(ctx, "translate_word_in_context", Temperature, system,
		BuildUserContent(sentence, word, definition))
	if err != nil {
		return Result{}, u, err
	}
	res, err := ParseResult(content)
	if err != nil {
		return Result{}, u, err
	}
	return res, u, nil
}
