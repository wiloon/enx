package aitranslate

import (
	"context"

	"enx-api/aitranslate/llm"
	"enx-api/utils/logger"
)

// retryParse runs call, a feature package's Call, up to attempts times while
// it fails on a reply that does not parse (Provider.ParseAttempts: MiniMax's
// "thinking" models occasionally write almost-JSON, which is usually a
// one-off). A failed chat is returned at once: auth, rate limit, timeout and
// the like aren't fixed by asking again, and each attempt costs real tokens.
// The usage sums every attempt made, since each one did consume tokens
// (ADR-014 bills by actual consumption).
func retryParse[R any](ctx context.Context, attempts int, chat llm.Chat, call func(context.Context, llm.Chat) (R, Usage, error)) (R, Usage, error) {
	if attempts <= 1 {
		return call(ctx, chat)
	}

	var (
		total   Usage
		feature string
		chatErr error
	)
	watched := func(ctx context.Context, f string, temperature float64, system, user string) (string, Usage, error) {
		feature = f
		content, u, err := chat(ctx, f, temperature, system, user)
		chatErr = err
		return content, u, err
	}

	var (
		res R
		err error
	)
	for attempt := 1; attempt <= attempts; attempt++ {
		var u Usage
		res, u, err = call(ctx, watched)
		total = sumUsage(total, u)
		if err == nil || chatErr != nil {
			return res, total, err
		}
		logger.Errorf("aitranslate: %s reply failed to parse (attempt %d/%d): %v", feature, attempt, attempts, err)
	}
	return res, total, err
}

func sumUsage(a, b Usage) Usage {
	return Usage{
		PromptTokens:     a.PromptTokens + b.PromptTokens,
		CompletionTokens: a.CompletionTokens + b.CompletionTokens,
		TotalTokens:      a.TotalTokens + b.TotalTokens,
	}
}
