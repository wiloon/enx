// Package wordcontext holds the contract for the "gloss one word as used in
// a sentence, informed by its dictionary definition" call: the caller looks
// up the word's dictionary entry first (ECDICT/Word table) and passes it
// along so the model can relate the contextual meaning to that dictionary
// definition when the definition doesn't cover it -- which sense it comes
// from and how -- rather than guessing blind. Used by
// the word-in-context endpoint once the dictionary lookup this word's card
// depends on has resolved (or failed -- an empty dictionary definition is a
// valid input, just one the model can't compare against).
//
// It is a leaf package: it runs on any llm.Chat and knows no provider.
// Mirrors aitranslate/sentenceword.
package wordcontext

import (
	"encoding/json"
	"fmt"
	"strings"

	"enx-api/aitranslate/en"
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

// EnglishSystemPrompt is SystemPrompt for a reader who wants explanations in
// plain English (ADR-098); the reply shape and the "why" rule are the same.
const EnglishSystemPrompt = `You help a learner of English. You are given an English sentence, one target word or short phrase taken from it, and (optionally) that word's dictionary definition.

Return ONLY a JSON object, no prose around it:
{"word": "<what the target word means AS USED IN THIS SENTENCE, in plain English, not a generic dictionary definition>",
 "why": "<one short plain-English sentence relating that meaning to the dictionary, or an empty string; see the rules>"}

Rules:
- "word": just the contextual meaning, as a short phrase. No quotes, no explanation.
- "why": first decide whether the dictionary definition covers the meaning in "word", then:
  - No dictionary definition given, or the meaning is one of its senses or an ordinary sense it already covers: "".
  - Not covered, but it comes from one dictionary sense: say why the word means this here, and name that one source sense and how the meaning comes from it (figurative extension, part-of-speech shift, idiom, narrowing).
  - Not covered and no dictionary sense is related (a proper noun, a new usage, a different word): say only why the word means this here.
  - One short sentence, no quotes. Never mention or rule out dictionary senses that don't apply.
` + en.PlainRule

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

// BuildUserContent formats the user message every provider sends alongside
// SystemPrompt. The dictionary definition line is omitted entirely when
// definition is empty, so the prompt never references a missing dictionary
// entry.
func BuildUserContent(sentence, word, definition string) string {
	content := fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word)
	if definition != "" {
		content += fmt.Sprintf("\nDictionary definition: %s", definition)
	}
	return content
}

// CheckEnglish rejects an English-mode result written in Chinese. It is not
// part of ParseResult, so a Chinese reply is not asked for again.
func CheckEnglish(res Result, sentence, word string) error {
	if en.IsChinese(res.WordChinese, sentence, word) || en.IsChinese(res.Why, sentence, word) {
		return en.ErrChineseReply
	}
	return nil
}

// ParseResult turns a provider's raw reply into a Result. The word gloss is
// required; a missing or empty why is fine (Result.Why). Extraction starts
// from a lenient "first brace to last brace" span, since small models don't
// reliably return a bare object even when told to, falling back to
// fieldFallback when that span isn't valid JSON. Either way, word and why
// come only from the reply's top-level object (#1136): a gloss nested
// anywhere deeper is not the model's answer for this word.
func ParseResult(raw string) (Result, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return Result{}, fmt.Errorf("wordcontext: reply contains no JSON object")
	}
	obj := raw[start : end+1]

	var wire wireResult
	if err := json.Unmarshal([]byte(obj), &wire); err == nil {
		return newResult(wire.Word, wire.Why)
	}

	return fieldFallback(obj)
}

// newResult trims the fields and rejects a blank word gloss.
func newResult(word, why string) (Result, error) {
	word = strings.TrimSpace(word)
	if word == "" {
		return Result{}, fmt.Errorf("wordcontext: reply has no word gloss")
	}
	return Result{WordChinese: word, Why: strings.TrimSpace(why)}, nil
}

// Positions of the top-level scan in fieldFallback.
const (
	expectKey   = iota // before a key: skips junk and commas
	expectColon        // after a key
	expectValue        // after the colon
	afterValue         // skips junk up to the next top-level comma
)

// fieldFallback recovers Result fields when obj as a whole doesn't parse as
// JSON. Chatty models sometimes drop the comma between fields and insert a
// stray remark instead (e.g. `"word": "..." Additional note here, "why":
// "..."`), which breaks strict parsing even though each field's own value
// is intact.
//
// It walks obj (which starts with '{') byte by byte, respecting string
// literals and escapes and tracking {/[ depth, and takes a "word" or "why"
// key only at depth 1 and only when its value is a quoted string. Nested
// values and junk between fields are skipped. The scan stops when the root
// object closes, ignoring anything after it; a root that never closes, or
// an unclosed string, is an error.
func fieldFallback(obj string) (Result, error) {
	var word, why, key string
	depth, state := 0, expectKey
	for i := 0; i < len(obj); i++ {
		c := obj[i]
		if c == '"' {
			end, ok := stringEnd(obj, i)
			if !ok {
				return Result{}, fmt.Errorf("wordcontext: reply has an unclosed string")
			}
			if depth == 1 {
				body := obj[i+1 : end]
				switch state {
				case expectKey:
					key, state = body, expectColon
				case expectColon:
					// A string where the colon belongs: treat it as a value.
					state = afterValue
				case expectValue:
					switch key {
					case "word":
						word = unquoteJSONString(body)
					case "why":
						why = unquoteJSONString(body)
					}
					state = afterValue
				}
			}
			i = end
			continue
		}
		switch c {
		case '{', '[':
			depth++
			if depth == 2 && (state == expectValue || state == expectColon) {
				state = afterValue
			}
			continue
		case '}', ']':
			if depth > 1 {
				depth--
				continue
			}
			if c == '}' {
				// The root closes: anything after it is ignored.
				return newResult(word, why)
			}
			// A stray ']' at the top level is junk.
		}
		if depth != 1 {
			continue
		}
		switch state {
		case expectColon:
			if c == ':' {
				state = expectValue
			} else if !isSpace(c) {
				state = afterValue
			}
		case expectValue:
			if c == ',' {
				state = expectKey
			} else if !isSpace(c) {
				// A number, literal or junk: not a quoted string.
				state = afterValue
			}
		case afterValue:
			if c == ',' {
				state = expectKey
			}
		}
	}
	return Result{}, fmt.Errorf("wordcontext: reply's JSON object never closes")
}

// stringEnd returns the index of the quote closing the string literal that
// opens at s[open], skipping backslash escapes. ok is false when the string
// never closes.
func stringEnd(s string, open int) (end int, ok bool) {
	for i := open + 1; i < len(s); i++ {
		switch s[i] {
		case '\\':
			if i+1 >= len(s) {
				return 0, false
			}
			i++
		case '"':
			return i, true
		}
	}
	return 0, false
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

// unquoteJSONString decodes a JSON string body's escape sequences (\", \n,
// \uXXXX, ...) by re-wrapping it as a JSON string literal and letting
// encoding/json unescape it. Falls back to the raw text if that isn't valid
// (stringEnd only guarantees the literal closes, not that every escape is
// well formed).
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
