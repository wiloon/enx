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
	"regexp"
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

// sentenceFieldPattern and wordFieldPattern pull a "sentence" or "word"
// field's quoted value out of a reply directly, without requiring the
// surrounding text to be a well-formed JSON object. Chatty models sometimes
// drop the comma between fields and insert a stray remark instead (e.g.
// `"sentence": "..." Additional note here, "word": "..."`), which breaks
// strict JSON parsing even though each field's own value is intact -- see
// fieldFallback below.
var (
	sentenceFieldPattern = regexp.MustCompile(`"sentence"\s*:\s*"((?:[^"\\]|\\.)*)"`)
	wordFieldPattern     = regexp.MustCompile(`"word"\s*:\s*"((?:[^"\\]|\\.)*)"`)
)

// ParseResult turns a provider's raw reply into a Result. The sentence
// translation is required; a missing or empty word gloss is tolerated (see
// Result.WordChinese). Extraction starts from the same lenient "first brace
// to last brace" span as aitranslate/rephrase, since small models don't
// reliably return a bare object even when told to; if that span isn't valid
// JSON, fieldFallback recovers the two fields independently rather than
// failing the whole reply over one model formatting slip.
func ParseResult(raw string) (Result, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return Result{}, fmt.Errorf("sentenceword: reply contains no JSON object")
	}
	obj := raw[start : end+1]

	var wire wireResult
	if err := json.Unmarshal([]byte(obj), &wire); err == nil {
		if sentence := strings.TrimSpace(wire.Sentence); sentence != "" {
			return Result{SentenceChinese: sentence, WordChinese: strings.TrimSpace(wire.Word)}, nil
		}
	}

	return fieldFallback(obj)
}

// fieldFallback recovers Result fields by regex when obj as a whole doesn't
// parse as JSON (or parsed but came out with no sentence). It only requires
// each field's own quoted value to be well-formed, so it survives the kind
// of malformed-but-recognizable reply that breaks encoding/json.
func fieldFallback(obj string) (Result, error) {
	sentence := unquoteJSONString(firstSubmatch(sentenceFieldPattern, obj))
	if strings.TrimSpace(sentence) == "" {
		return Result{}, fmt.Errorf("sentenceword: reply has no sentence translation")
	}
	word := unquoteJSONString(firstSubmatch(wordFieldPattern, obj))
	return Result{SentenceChinese: strings.TrimSpace(sentence), WordChinese: strings.TrimSpace(word)}, nil
}

func firstSubmatch(re *regexp.Regexp, s string) string {
	m := re.FindStringSubmatch(s)
	if m == nil {
		return ""
	}
	return m[1]
}

// unquoteJSONString decodes a JSON string body's escape sequences (\", \n,
// \uXXXX, ...) by re-wrapping it as a JSON string literal and letting
// encoding/json unescape it. Falls back to the raw text if that somehow
// isn't valid (the regex it comes from guarantees well-formed escapes, so
// this is only a safety net).
func unquoteJSONString(s string) string {
	if s == "" {
		return ""
	}
	var out string
	if err := json.Unmarshal([]byte(`"`+s+`"`), &out); err != nil {
		return s
	}
	return out
}
