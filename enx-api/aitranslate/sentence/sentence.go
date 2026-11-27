// Package sentence holds the plain "translate one English sentence into
// Chinese" call: its prompt and temperature, Call, and the Check on the reply.
package sentence

import (
	"context"
	"errors"
	"strings"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/zh"
)

// SystemPrompt asks for the translation and nothing else, so the reply can be
// shown as-is.
const SystemPrompt = `You are a professional English-to-Chinese translator. Translate the given English sentence into natural, fluent Simplified Chinese.

Rules:
- Reply with the Chinese translation only, no explanation, no pinyin, no quotes.
` + zh.SimplifiedRule

// Temperature: one most-natural rendering, not creative variety.
const Temperature = 0.3

// Call translates text on any provider. The reply is returned as the model
// wrote it; the caller runs Check on it.
func Call(ctx context.Context, chat llm.Chat, text string) (string, aiusage.Usage, error) {
	return chat(ctx, "translate_sentence", Temperature, SystemPrompt, text)
}

// ErrEmptyTranslation: the model replied, but with nothing to show.
var ErrEmptyTranslation = errors.New("empty translation")

// Check rejects a reply that is unusable as a translation: one that is empty or
// only whitespace.
func Check(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return ErrEmptyTranslation
	}
	return nil
}
