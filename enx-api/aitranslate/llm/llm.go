// Package llm names the one call a provider offers and the feature packages
// (sentence, sentenceword, wordcontext, worddef, rephrase) need: send a
// system and a user prompt, get back the reply text and its token usage. Each provider
// adapts its own request (Chat Completions, Bedrock Converse) to Chat, so a
// feature's prompt-and-parse steps live once in its own package.
package llm

import (
	"context"

	"enx-api/aitranslate/aiusage"
)

// Chat sends one prompt to a model. feature names the call in the usage
// log. A provider that has no temperature knob ignores temperature. On
// error the usage is whatever the provider could report, so the caller can
// still bill the tokens that were spent.
type Chat func(ctx context.Context, feature string, temperature float64, system, user string) (string, aiusage.Usage, error)
