package aitranslate_test

import (
	"strings"
	"testing"

	"enx-api/aitranslate/rephrase"
	"enx-api/aitranslate/sentence"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
	"enx-api/aitranslate/worddef"
)

// Every prompt whose reply contains Chinese must pin the script: told only
// "Chinese", models sometimes answer in Traditional Chinese.
func TestEveryPromptThatWritesChineseRequiresSimplifiedChinese(t *testing.T) {
	prompts := map[string]string{
		"sentence":     sentence.SystemPrompt,
		"sentenceword": sentenceword.SystemPrompt,
		"wordcontext":  wordcontext.SystemPrompt,
		"worddef":      worddef.SystemPrompt,
		"rephrase":     rephrase.SystemPrompt,
	}
	for name, prompt := range prompts {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(prompt, "Simplified Chinese") {
				t.Errorf("prompt does not ask for Simplified Chinese:\n%s", prompt)
			}
			if !strings.Contains(prompt, "Never use Traditional Chinese") {
				t.Errorf("prompt does not forbid Traditional Chinese:\n%s", prompt)
			}
		})
	}
}
