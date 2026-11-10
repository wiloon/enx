// Package wordcontext holds the contract for the "gloss one word as used in
// a sentence, informed by its dictionary definition" call: the caller looks
// up the word's dictionary entry first (ECDICT/Word table) and passes it
// along so the model can relate the contextual meaning to that dictionary
// definition when the definition doesn't cover it -- which sense it comes
// from and how -- rather than guessing blind. Used by
// TranslateWordInContext once the dictionary lookup this word's card
// depends on has resolved (or failed -- an empty dictionary definition is a
// valid input, just one the model can't compare against).
//
// It is a leaf package -- both aitranslate and the provider packages import
// it, so a provider's TranslateWordInContext method can name Result as its
// return type without an import cycle. Mirrors aitranslate/sentenceword.
package wordcontext

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"enx-api/aitranslate/zh"
)

// SystemPrompt asks the model for the target word's meaning as used in THIS
// sentence, then whether the supplied dictionary definition covers that
// meaning. Covered (or no definition supplied): why is empty. Not covered:
// why says in one short sentence why the word means this here and, when the
// meaning grows out of one dictionary sense, names that sense and how
// (figurative extension, part-of-speech shift, idiom, narrowing). why never
// negates or lists dictionary senses that don't apply: the card already
// shows the dictionary definition next to it.
const SystemPrompt = `You are a professional English-to-Chinese translator. You are given an English sentence, one target word or short phrase taken from it, and (optionally) that word's dictionary definition.

Return ONLY a JSON object, no prose around it:
{"word": "<the target word's Chinese meaning AS USED IN THIS SENTENCE, not a generic dictionary definition>",
 "why": "<one short Chinese sentence relating that meaning to the dictionary, or an empty string; see the rules>"}

Rules:
- "word": just the contextual meaning, usually a few characters. No pinyin, no quotes, no explanation.
- "why": first decide whether the dictionary definition covers the meaning in "word", then:
  - No dictionary definition given, or the meaning is one of its senses or an ordinary sense it already covers: "".
  - Not covered, but it comes from one dictionary sense: say why the word means this here, and name that one source sense and how the meaning comes from it (figurative extension, part-of-speech shift, idiom, narrowing).
  - Not covered and no dictionary sense is related (a proper noun, a new usage, a different word): say only why the word means this here.
  - One short sentence, no pinyin, no quotes. Never mention or rule out dictionary senses that don't apply.
` + zh.SimplifiedRule

// Temperature matches sentenceword's 0.3 -- one most-natural rendering, not
// creative variety.
const Temperature = 0.3

// Result is the parsed reply. Why is empty whenever the model judged the
// contextual meaning covered by the dictionary definition, or no dictionary
// definition was available to compare against. Otherwise it is one short
// sentence on why the word means this here, naming at most the one
// dictionary sense the meaning comes from.
type Result struct {
	WordChinese string
	Why         string
}

type wireResult struct {
	Word string `json:"word"`
	Why  string `json:"why"`
}

// wordFieldPattern and whyFieldPattern pull a "word" or "why" field's
// quoted value out of a reply directly, without requiring the surrounding
// text to be a well-formed JSON object -- see fieldFallback below, and
// sentenceword's identical rationale for this fallback.
var (
	wordFieldPattern = regexp.MustCompile(`"word"\s*:\s*"((?:[^"\\]|\\.)*)"`)
	whyFieldPattern  = regexp.MustCompile(`"why"\s*:\s*"((?:[^"\\]|\\.)*)"`)
)

// BuildUserContent formats the user message every provider sends alongside
// SystemPrompt. The dictionary definition line is omitted entirely when
// dictionaryChinese is empty, so the prompt never references a missing
// dictionary entry.
func BuildUserContent(sentence, word, dictionaryChinese string) string {
	content := fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word)
	if dictionaryChinese != "" {
		content += fmt.Sprintf("\nDictionary definition: %s", dictionaryChinese)
	}
	return content
}

// ParseResult turns a provider's raw reply into a Result. The word gloss is
// required; a missing or empty why is fine (Result.Why). Extraction starts
// from the same lenient "first brace to last brace" span as sentenceword,
// falling back to fieldFallback when that span isn't valid JSON.
func ParseResult(raw string) (Result, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return Result{}, fmt.Errorf("wordcontext: reply contains no JSON object")
	}
	obj := raw[start : end+1]

	var wire wireResult
	if err := json.Unmarshal([]byte(obj), &wire); err == nil {
		if word := strings.TrimSpace(wire.Word); word != "" {
			return Result{WordChinese: word, Why: strings.TrimSpace(wire.Why)}, nil
		}
	}

	return fieldFallback(obj)
}

// fieldFallback recovers Result fields by regex when obj as a whole doesn't
// parse as JSON (or parsed but came out with no word gloss).
func fieldFallback(obj string) (Result, error) {
	word := unquoteJSONString(firstSubmatch(wordFieldPattern, obj))
	if strings.TrimSpace(word) == "" {
		return Result{}, fmt.Errorf("wordcontext: reply has no word gloss")
	}
	why := unquoteJSONString(firstSubmatch(whyFieldPattern, obj))
	return Result{WordChinese: strings.TrimSpace(word), Why: strings.TrimSpace(why)}, nil
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
