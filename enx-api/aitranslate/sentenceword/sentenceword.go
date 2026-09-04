// Package sentenceword holds the contract for the combined "translate the
// whole sentence AND gloss one word as used in that sentence" call
// (ADR-014): one LLM round-trip that replaces the earlier two separate calls
// (translate/sentence + translate/word-in-context) made when the Side Panel
// is opened from a word click.
//
// It is a leaf package -- both aitranslate and the provider packages import
// it, so a provider's TranslateSentenceWithWord method can name Result as
// its return type without an import cycle. Mirrors aitranslate/rephrase.
package sentenceword

import (
	"encoding/json"
	"fmt"
	"strings"
)

// SystemPrompt asks the model to return both the whole-sentence translation
// and the target word's meaning as used in THIS sentence (not a generic
// dictionary gloss), as one JSON object.
const SystemPrompt = `You are a professional English-to-Chinese translator. You are given an English sentence and one target word or short phrase taken from it.

Return ONLY a JSON object, no prose around it:
{"sentence": "<natural fluent Chinese translation of the whole sentence>",
 "word": "<the target word's Chinese meaning AS USED IN THIS SENTENCE, not a generic dictionary definition>"}

Rules:
- "sentence": the whole sentence in natural Chinese. No pinyin, no quotes, no explanation.
- "word": just the contextual meaning, usually a few characters. No pinyin, no quotes, no explanation.`

// Temperature matches plain translation's 0.3 -- one most-natural rendering,
// not creative variety.
const Temperature = 0.3

// Result is the parsed combined translation. WordChinese is empty when the
// model returned a usable sentence translation but omitted (or emptied) the
// word gloss: the caller degrades gracefully -- falling back to a separate
// word-in-context call -- rather than failing the whole request (ADR-014).
type Result struct {
	SentenceChinese string
	WordChinese     string
}

type wireResult struct {
	Sentence string `json:"sentence"`
	Word     string `json:"word"`
}

// ParseResult turns a provider's raw reply into a Result. The sentence
// translation is required; a missing or empty word gloss is tolerated (see
// Result.WordChinese). Extraction is the same lenient "first brace to last
// brace" span as aitranslate/rephrase, since small models don't reliably
// return a bare object even when told to.
func ParseResult(raw string) (Result, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return Result{}, fmt.Errorf("sentenceword: reply contains no JSON object")
	}

	var wire wireResult
	if err := json.Unmarshal([]byte(raw[start:end+1]), &wire); err != nil {
		return Result{}, fmt.Errorf("sentenceword: reply is not valid JSON: %w", err)
	}
	if strings.TrimSpace(wire.Sentence) == "" {
		return Result{}, fmt.Errorf("sentenceword: reply has no sentence translation")
	}

	return Result{
		SentenceChinese: strings.TrimSpace(wire.Sentence),
		WordChinese:     strings.TrimSpace(wire.Word),
	}, nil
}
