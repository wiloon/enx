package minimax

import (
	"context"
	"fmt"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/sentenceword"
	"enx-api/utils/logger"
)

// sentenceWithWordMaxAttempts bounds retries of a malformed reply. MiniMax's
// "thinking" models occasionally write almost-JSON (e.g. a dropped comma
// followed by a stray remark, see sentenceword.ParseResult's fallback) --
// that's usually a one-off, so asking again is worth one retry. It is NOT
// retried on a transport/API error from m.chat (auth, rate limit, timeout,
// ...): those aren't fixed by asking again and each attempt costs real
// tokens.
const sentenceWithWordMaxAttempts = 2

// TranslateSentenceWithWord implements aitranslate.Translator's combined
// call (ADR-014): one MiniMax request returns both the whole-sentence
// translation and the target word's in-context meaning as JSON.
// sentenceword.ParseResult is lenient about fences and stray prose; a
// missing word gloss is tolerated (empty Result.WordChinese), a missing
// sentence translation is retried once (see sentenceWithWordMaxAttempts)
// before giving up. Returned usage sums every attempt actually made, since
// each one really did consume tokens (ADR-014 bills by actual consumption).
func (m *MiniMax) TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, aiusage.Usage, error) {
	var (
		total   aiusage.Usage
		lastErr error
	)
	for attempt := 1; attempt <= sentenceWithWordMaxAttempts; attempt++ {
		content, u, err := m.chat(
			ctx,
			"translate_sentence_with_word",
			sentenceword.Temperature,
			sentenceword.SystemPrompt,
			fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word),
		)
		if err != nil {
			return sentenceword.Result{}, sumUsage(total, toUsage(u)), err
		}
		total = sumUsage(total, toUsage(u))

		res, err := sentenceword.ParseResult(content)
		if err == nil {
			return res, total, nil
		}
		lastErr = err
		logger.Errorf("aitranslate: translate_sentence_with_word reply failed to parse (attempt %d/%d): %v", attempt, sentenceWithWordMaxAttempts, err)
	}
	return sentenceword.Result{}, total, lastErr
}

func sumUsage(a, b aiusage.Usage) aiusage.Usage {
	return aiusage.Usage{
		PromptTokens:     a.PromptTokens + b.PromptTokens,
		CompletionTokens: a.CompletionTokens + b.CompletionTokens,
		TotalTokens:      a.TotalTokens + b.TotalTokens,
	}
}
