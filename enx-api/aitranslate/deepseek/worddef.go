package deepseek

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/worddef"
)

// DefineWord implements aitranslate.WordDefiner (ADR-045): one DeepSeek request
// that defines a single word with no sentence. worddef.ParseResult is strict,
// because the reply can end up stored in the shared words table: a reply that
// does not pass is an error, and the tokens it used are still reported so the
// caller can bill them.
func (d *DeepSeek) DefineWord(ctx context.Context, word string) (worddef.Result, aiusage.Usage, error) {
	content, u, err := d.chat(
		ctx,
		"define_word",
		d.model,
		worddef.Temperature,
		worddef.SystemPrompt,
		worddef.BuildUserContent(word),
	)
	if err != nil {
		return worddef.Result{}, toUsage(u), err
	}

	res, err := worddef.ParseResult(content)
	if err != nil {
		return worddef.Result{}, toUsage(u), err
	}
	return res, toUsage(u), nil
}
