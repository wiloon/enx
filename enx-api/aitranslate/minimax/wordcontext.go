package minimax

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/wordcontext"
	"enx-api/utils/logger"
)

// wordContextMaxAttempts mirrors sentenceWithWordMaxAttempts's rationale:
// one retry for an occasional almost-JSON reply from MiniMax's "thinking"
// models, never retried on a transport/API error.
const wordContextMaxAttempts = 2

// TranslateWordInContext implements aitranslate.Translator's dictionary-first
// word gloss call: one MiniMax request returns the target word's in-context
// meaning plus (when a dictionary definition was supplied and the meanings
// diverge) a short explanation why, as JSON. wordcontext.ParseResult is
// lenient about fences and stray prose; a missing why is tolerated, a
// missing word gloss is retried once before giving up. Returned usage sums
// every attempt actually made, since each one really did consume tokens.
func (m *MiniMax) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, aiusage.Usage, error) {
	var (
		total   aiusage.Usage
		lastErr error
	)
	for attempt := 1; attempt <= wordContextMaxAttempts; attempt++ {
		content, u, err := m.chat(
			ctx,
			"translate_word_in_context",
			wordcontext.Temperature,
			wordcontext.SystemPrompt,
			wordcontext.BuildUserContent(sentence, word, dictionaryChinese),
		)
		if err != nil {
			return wordcontext.Result{}, sumUsage(total, toUsage(u)), err
		}
		total = sumUsage(total, toUsage(u))

		res, err := wordcontext.ParseResult(content)
		if err == nil {
			return res, total, nil
		}
		lastErr = err
		logger.Errorf("aitranslate: translate_word_in_context reply failed to parse (attempt %d/%d): %v", attempt, wordContextMaxAttempts, err)
	}
	return wordcontext.Result{}, total, lastErr
}
