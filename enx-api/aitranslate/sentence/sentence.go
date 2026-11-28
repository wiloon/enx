// Package sentence holds the "say what one English sentence says" call, as a
// Chinese translation or as a restatement in simpler English (ADR-098): its
// prompts and temperature, Call and CallEnglish, and the checks on the reply.
package sentence

import (
	"context"
	"errors"
	"strings"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/en"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/zh"
)

// SystemPrompt asks for the translation and nothing else, so the reply can be
// shown as-is.
const SystemPrompt = `You are a professional English-to-Chinese translator. Translate the given English sentence into natural, fluent Simplified Chinese.

Rules:
- Reply with the Chinese translation only, no explanation, no pinyin, no quotes.
` + zh.SimplifiedRule

// EnglishSystemPrompt asks for a restatement in simpler English instead of a
// translation: the same job, telling the reader what the sentence says.
const EnglishSystemPrompt = `You help a learner of English. Restate the given English sentence in simpler English, so that the reader understands what it says.

Rules:
- Reply with one restatement only: no notes on words, no explanation of hard words, no quotes.
` + en.PlainRule

// Temperature: one most-natural rendering, not creative variety.
const Temperature = 0.3

// Call translates text on any provider. The reply is returned as the model
// wrote it; the caller runs Check on it.
func Call(ctx context.Context, chat llm.Chat, text string) (string, aiusage.Usage, error) {
	return chat(ctx, "translate_sentence", Temperature, SystemPrompt, text)
}

// CallEnglish restates text in simpler English; otherwise like Call.
func CallEnglish(ctx context.Context, chat llm.Chat, text string) (string, aiusage.Usage, error) {
	return chat(ctx, "translate_sentence", Temperature, EnglishSystemPrompt, text)
}

// CheckEnglish rejects a restatement of source that is in Chinese.
func CheckEnglish(raw, source string) error {
	if en.IsChinese(raw, source) {
		return en.ErrChineseReply
	}
	return nil
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
