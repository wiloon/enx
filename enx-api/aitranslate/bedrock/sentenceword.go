package bedrock

import (
	"context"
	"fmt"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/sentenceword"
)

// TranslateSentenceWithWord implements aitranslate.Translator's combined
// call (ADR-014): one Converse request returns both the whole-sentence
// translation and the target word's in-context meaning as JSON.
// sentenceword.ParseResult is lenient about fences and stray prose; a
// missing word gloss is tolerated (empty Result.WordChinese), a missing
// sentence translation is an error. Token usage from the response is
// returned so the caller bills by actual consumption.
func (b *Bedrock) TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, aiusage.Usage, error) {
	content, u, err := b.converse(
		ctx,
		"translate_sentence_with_word",
		sentenceword.SystemPrompt,
		fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word),
	)
	if err != nil {
		return sentenceword.Result{}, u, err
	}

	res, err := sentenceword.ParseResult(content)
	if err != nil {
		return sentenceword.Result{}, u, err
	}
	return res, u, nil
}
