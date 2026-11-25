package minimax

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/utils/logger"
)

// parseMaxAttempts bounds retries of a malformed reply. MiniMax's
// "thinking" models occasionally write almost-JSON (e.g. a dropped comma
// followed by a stray remark, see wordcontext.ParseResult's fallback) --
// that's usually a one-off, so asking again is worth one retry. It is NOT
// retried on a transport/API error from m.chat (auth, rate limit, timeout,
// ...): those aren't fixed by asking again and each attempt costs real
// tokens.
const parseMaxAttempts = 2

// retryParse runs call, a feature package's Call, up to parseMaxAttempts
// times while it fails on a reply that does not parse. A failed request is
// returned at once. The usage sums every attempt made, since each one
// really did consume tokens (ADR-014 bills by actual consumption).
func retryParse[R any](ctx context.Context, chat llm.Chat, call func(context.Context, llm.Chat) (R, aiusage.Usage, error)) (R, aiusage.Usage, error) {
	var (
		total   aiusage.Usage
		feature string
		chatErr error
	)
	watched := func(ctx context.Context, f string, temperature float64, system, user string) (string, aiusage.Usage, error) {
		feature = f
		content, u, err := chat(ctx, f, temperature, system, user)
		chatErr = err
		return content, u, err
	}

	var (
		res R
		err error
	)
	for attempt := 1; attempt <= parseMaxAttempts; attempt++ {
		var u aiusage.Usage
		res, u, err = call(ctx, watched)
		total = sumUsage(total, u)
		if err == nil || chatErr != nil {
			return res, total, err
		}
		logger.Errorf("aitranslate: %s reply failed to parse (attempt %d/%d): %v", feature, attempt, parseMaxAttempts, err)
	}
	return res, total, err
}

func sumUsage(a, b aiusage.Usage) aiusage.Usage {
	return aiusage.Usage{
		PromptTokens:     a.PromptTokens + b.PromptTokens,
		CompletionTokens: a.CompletionTokens + b.CompletionTokens,
		TotalTokens:      a.TotalTokens + b.TotalTokens,
	}
}
