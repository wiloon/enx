// Package sentence holds the contract for the plain "translate one English
// sentence into Chinese" call: the prompt and temperature every provider's
// TranslateSentence sends. Like sentenceword and wordcontext it is a leaf
// package, so the provider packages can import it without a cycle.
package sentence

import "enx-api/aitranslate/zh"

// SystemPrompt asks for the translation and nothing else, so the reply can be
// shown as-is.
const SystemPrompt = `You are a professional English-to-Chinese translator. Translate the given English sentence into natural, fluent Simplified Chinese.

Rules:
- Reply with the Chinese translation only, no explanation, no pinyin, no quotes.
` + zh.SimplifiedRule

// Temperature: one most-natural rendering, not creative variety.
const Temperature = 0.3
