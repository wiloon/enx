package sentenceword

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/zh"
)

// The multi-word variant (ADR-023 Decision 9): one call translates the
// sentence and glosses every word the Side Panel's sentence card absorbed,
// each informed by its own dictionary meaning.

// WordsSystemPrompt asks for the sentence translation plus one gloss entry
// per listed word, applying the same "why" rule as wordcontext.SystemPrompt
// (ADR-024) to each.
const WordsSystemPrompt = `You are a professional English-to-Chinese translator. You are given an English sentence and a numbered list of target words or short phrases taken from it, each with an optional dictionary definition.

Return ONLY a JSON object, no prose around it:
{"sentence": "<natural fluent Chinese translation of the whole sentence>",
 "words": [{"word": "<the target word exactly as listed>",
            "chinese": "<its Chinese meaning AS USED IN THIS SENTENCE, not a generic dictionary definition>",
            "why": "<one short Chinese sentence relating that meaning to the dictionary, or an empty string; see the rules>"}]}

Rules:
- "sentence": the whole sentence in natural Chinese. No pinyin, no quotes, no explanation.
- "words": one entry per listed word, in the listed order.
- "chinese": just the contextual meaning, usually a few characters. No pinyin, no quotes, no explanation.
- "why": first decide whether the word's dictionary definition covers the meaning in "chinese", then:
  - No dictionary definition given, or the meaning is one of its senses or an ordinary sense it already covers: "".
  - Not covered, but it comes from one dictionary sense: say why the word means this here, and name that one source sense and how the meaning comes from it (figurative extension, part-of-speech shift, idiom, narrowing).
  - Not covered and no dictionary sense is related (a proper noun, a new usage, a different word): say only why the word means this here.
  - One short sentence, no pinyin, no quotes. Never mention or rule out dictionary senses that don't apply.
` + zh.SimplifiedRule

// WordInput is one word to gloss with its dictionary meaning (may be empty).
type WordInput struct {
	Word              string
	DictionaryChinese string
}

// WordGloss is one word's contextual meaning. Chinese and Why are both empty
// when the model gave no usable gloss: the caller falls back to an individual
// word-in-context call for that word.
type WordGloss struct {
	Word    string
	Chinese string
	Why     string
}

// WordsResult is the parsed multi-word reply; Words is in request order.
type WordsResult struct {
	SentenceChinese string
	Words           []WordGloss
}

// NormalizeWord mirrors enx-chrome's normalizeCardText: trim, collapse
// whitespace runs to one space, lowercase.
func NormalizeWord(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// DedupeWords drops blank words and later duplicates by NormalizeWord, keeping
// the first occurrence in request order.
func DedupeWords(words []WordInput) []WordInput {
	seen := make(map[string]bool, len(words))
	out := make([]WordInput, 0, len(words))
	for _, w := range words {
		key := NormalizeWord(w.Word)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, w)
	}
	return out
}

// BuildWordsUserContent formats the user message for the multi-word call.
func BuildWordsUserContent(sentence string, words []WordInput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Sentence: %s\nWords:", sentence)
	for i, w := range words {
		fmt.Fprintf(&b, "\n%d. %s", i+1, w.Word)
		if w.DictionaryChinese != "" {
			fmt.Fprintf(&b, " | Dictionary definition: %s", w.DictionaryChinese)
		}
	}
	return b.String()
}

type wireWordsResult struct {
	Sentence string `json:"sentence"`
	Words    []struct {
		Word    string `json:"word"`
		Chinese string `json:"chinese"`
		Why     string `json:"why"`
	} `json:"words"`
}

// ParseWordsResult turns a provider's raw reply into a WordsResult for the
// (already deduplicated) request words. The sentence translation is required.
// Entries match request words by NormalizeWord; extra entries are ignored and
// a duplicate entry contributes its first nonblank gloss. A word with no
// usable gloss comes back with empty Chinese and Why, as does every word when
// the reply is not valid JSON but its sentence field is recoverable.
func ParseWordsResult(raw string, words []WordInput) (WordsResult, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return WordsResult{}, fmt.Errorf("sentenceword: reply contains no JSON object")
	}
	obj := raw[start : end+1]

	var wire wireWordsResult
	if err := json.Unmarshal([]byte(obj), &wire); err == nil {
		if sentence := strings.TrimSpace(wire.Sentence); sentence != "" {
			type gloss struct{ chinese, why string }
			byKey := map[string]gloss{}
			for _, e := range wire.Words {
				key := NormalizeWord(e.Word)
				chinese := strings.TrimSpace(e.Chinese)
				if key == "" || chinese == "" {
					continue
				}
				if _, ok := byKey[key]; !ok {
					byKey[key] = gloss{chinese, strings.TrimSpace(e.Why)}
				}
			}
			out := WordsResult{SentenceChinese: sentence, Words: make([]WordGloss, len(words))}
			for i, w := range words {
				g := byKey[NormalizeWord(w.Word)]
				if strings.TrimSpace(w.DictionaryChinese) == "" {
					g.why = ""
				}
				out.Words[i] = WordGloss{Word: w.Word, Chinese: g.chinese, Why: g.why}
			}
			return out, nil
		}
	}

	sentence := strings.TrimSpace(unquoteJSONString(firstSubmatch(sentenceFieldPattern, obj)))
	if sentence == "" {
		return WordsResult{}, fmt.Errorf("sentenceword: reply has no sentence translation")
	}
	out := WordsResult{SentenceChinese: sentence, Words: make([]WordGloss, len(words))}
	for i, w := range words {
		out.Words[i] = WordGloss{Word: w.Word}
	}
	return out, nil
}

// CallWords is the multi-word combined translation on any provider: one
// prompt, one chat call. The usage is returned on every path so the caller
// bills by actual consumption.
func CallWords(ctx context.Context, chat llm.Chat, sentence string, words []WordInput) (WordsResult, aiusage.Usage, error) {
	content, u, err := chat(ctx, "translate_sentence_with_word", Temperature, WordsSystemPrompt,
		BuildWordsUserContent(sentence, words))
	if err != nil {
		return WordsResult{}, u, err
	}
	res, err := ParseWordsResult(content, words)
	if err != nil {
		return WordsResult{}, u, err
	}
	return res, u, nil
}
