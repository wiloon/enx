package sentenceword

import (
	"context"
	"slices"
	"strings"
	"testing"

	"enx-api/aitranslate/aiusage"
)

var bankRun = []WordInput{
	{Word: "bank", DictionaryChinese: "银行"},
	{Word: "run", DictionaryChinese: ""},
}

func TestDedupeWordsKeepsFirstByNormalizedText(t *testing.T) {
	got := DedupeWords([]WordInput{
		{Word: " Bank ", DictionaryChinese: "银行"},
		{Word: "bank", DictionaryChinese: "other"},
		{Word: "  ", DictionaryChinese: "x"},
		{Word: "Look   up", DictionaryChinese: "查"},
		{Word: "look up"},
	})
	if len(got) != 2 || got[0].Word != " Bank " || got[0].DictionaryChinese != "银行" || got[1].Word != "Look   up" {
		t.Fatalf("got %+v", got)
	}
}

func TestDedupeWordsMatchesChromeCardKeys(t *testing.T) {
	got := DedupeWords([]WordInput{
		{Word: "\uFEFFbank", DictionaryChinese: "银行"},
		{Word: "bank"},
		{Word: "\uFEFF"},
		{Word: "LOOK\u00A0\uFEFFup"},
		{Word: "look up"},
		{Word: "İ"},
		{Word: "i\u0307"},
		{Word: "i"},
		{Word: "ΟΣ"},
		{Word: "ος"},
		{Word: "\u0085bank"},
	})
	want := []WordInput{
		{Word: "\uFEFFbank", DictionaryChinese: "银行"},
		{Word: "LOOK\u00A0\uFEFFup"},
		{Word: "İ"},
		{Word: "i"},
		{Word: "ΟΣ"},
		{Word: "\u0085bank"},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("got %+q, want %+q", got, want)
	}
}

func TestParseWordsResultMatchesChromeCardKeys(t *testing.T) {
	raw := `{"sentence":"句子","words":[{"word":"bank","chinese":"银行"},{"word":"i\u0307","chinese":"字母"}]}`
	words := []WordInput{{Word: "\uFEFFbank"}, {Word: "İ"}}
	res, err := ParseWordsResult(raw, words)
	want := []WordGloss{{Word: "\uFEFFbank", Chinese: "银行"}, {Word: "İ", Chinese: "字母"}}
	if err != nil || !slices.Equal(res.Words, want) {
		t.Fatalf("got %+v, %v, want %+v", res.Words, err, want)
	}
}

func TestParseWordsResultMapsGlossesInRequestOrder(t *testing.T) {
	raw := "```json\n" + `{"sentence":"我在银行存钱。","words":[` +
		`{"word":"RUN","chinese":"经营","why":"引申义"},` +
		`{"word":"bank","chinese":"银行","why":"不该出现"},` +
		`{"word":"extra","chinese":"多余","why":""}]}` + "\n```"
	res, err := ParseWordsResult(raw, bankRun)
	if err != nil {
		t.Fatal(err)
	}
	if res.SentenceChinese != "我在银行存钱。" || len(res.Words) != 2 {
		t.Fatalf("got %+v", res)
	}
	// bank has a dictionary meaning, so its why is kept; run has none, so why is forced empty.
	if res.Words[0] != (WordGloss{Word: "bank", Chinese: "银行", Why: "不该出现"}) {
		t.Fatalf("bank: %+v", res.Words[0])
	}
	if res.Words[1] != (WordGloss{Word: "run", Chinese: "经营", Why: ""}) {
		t.Fatalf("run: %+v", res.Words[1])
	}
}

func TestParseWordsResultMissingAndBlankGlossesAreEmpty(t *testing.T) {
	raw := `{"sentence":"句子","words":[{"word":"bank","chinese":"  ","why":"x"}]}`
	res, err := ParseWordsResult(raw, bankRun)
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range res.Words {
		if w.Chinese != "" || w.Why != "" {
			t.Fatalf("expected empty gloss and why, got %+v", w)
		}
	}
	if len(res.Words) != 2 || res.Words[0].Word != "bank" || res.Words[1].Word != "run" {
		t.Fatalf("words must be echoed: %+v", res.Words)
	}
}

func TestParseWordsResultDuplicateEntryUsesFirstNonblank(t *testing.T) {
	raw := `{"sentence":"句子","words":[{"word":"bank","chinese":"","why":""},` +
		`{"word":"Bank","chinese":"岸","why":"a"},{"word":"bank","chinese":"银行","why":"b"}]}`
	res, err := ParseWordsResult(raw, bankRun[:1])
	if err != nil {
		t.Fatal(err)
	}
	if res.Words[0].Chinese != "岸" || res.Words[0].Why != "a" {
		t.Fatalf("got %+v", res.Words[0])
	}
}

func TestParseWordsResultKeepsValidGlossesBesideMalformedEntries(t *testing.T) {
	raw := `{"sentence":"句子","words":[{"word":"bank","chinese":"银行","why":"引申义"},` +
		`{"word":"extra","chinese":42},{"word":"run","chinese":"跑"}]}`
	res, err := ParseWordsResult(raw, bankRun)
	if err != nil || res.SentenceChinese != "句子" || len(res.Words) != 2 ||
		res.Words[0] != (WordGloss{Word: "bank", Chinese: "银行", Why: "引申义"}) ||
		res.Words[1] != (WordGloss{Word: "run", Chinese: "跑"}) {
		t.Fatalf("got %+v, %v, want both valid glosses", res, err)
	}
}

func TestParseWordsResultMalformedJSONRecoversSentence(t *testing.T) {
	raw := `{"sentence": "我在银行存钱。" oops, "words": [{"word": "bank", "chinese": "银行"}`
	res, err := ParseWordsResult(raw, bankRun)
	if err != nil {
		t.Fatal(err)
	}
	if res.SentenceChinese != "我在银行存钱。" {
		t.Fatalf("sentence: %+v", res)
	}
	if len(res.Words) != 2 || res.Words[0].Chinese != "" || res.Words[1].Chinese != "" {
		t.Fatalf("unmatched words must have empty glosses: %+v", res.Words)
	}
}

func TestParseWordsResultRecoversSentenceFromTruncatedObject(t *testing.T) {
	res, err := ParseWordsResult(`{"sentence":"译文","words":[`, bankRun)
	if err != nil || res.SentenceChinese != "译文" {
		t.Fatalf("got %+v, %v, want recovered sentence", res, err)
	}
	if len(res.Words) != 2 || res.Words[0] != (WordGloss{Word: "bank"}) || res.Words[1] != (WordGloss{Word: "run"}) {
		t.Fatalf("want empty glosses for the requested words, got %+v", res.Words)
	}
}

func TestParseWordsResultRejectsNestedSentence(t *testing.T) {
	for _, raw := range []string{
		`{"words":[{"sentence":"例句"}]}`,
		`{"metadata":{"sentence":"例句"}, "words":[`,
	} {
		if res, err := ParseWordsResult(raw, bankRun); err == nil {
			t.Errorf("got %+v for %q, want a missing sentence error", res, raw)
		}
	}
}

func TestParseWordsResultWithoutSentenceFails(t *testing.T) {
	for _, raw := range []string{
		`{"words":[{"word":"bank","chinese":"银行"}]}`,
		`{"sentence":"  ","words":[]}`,
		`no json here`,
	} {
		if _, err := ParseWordsResult(raw, bankRun); err == nil {
			t.Fatalf("expected an error for %q", raw)
		}
	}
}

func TestCallWordsSendsEveryDictionaryMeaningInOnePrompt(t *testing.T) {
	calls := 0
	var system, user, feature string
	chat := func(_ context.Context, f string, _ float64, s, u string) (string, aiusage.Usage, error) {
		calls++
		feature, system, user = f, s, u
		return `{"sentence":"句子","words":[{"word":"bank","chinese":"银行","why":""},{"word":"run","chinese":"跑","why":""}]}`,
			aiusage.Usage{PromptTokens: 5, CompletionTokens: 7}, nil
	}
	res, u, err := CallWords(context.Background(), chat, "I run to the bank.", bankRun)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || feature != "translate_sentence_with_word" || u.PromptTokens != 5 {
		t.Fatalf("calls=%d feature=%q usage=%+v", calls, feature, u)
	}
	if !strings.Contains(user, "I run to the bank.") || !strings.Contains(user, "bank") || !strings.Contains(user, "银行") {
		t.Fatalf("user prompt misses the sentence or a dictionary meaning: %q", user)
	}
	if !strings.Contains(system, `"words"`) {
		t.Fatalf("system prompt does not describe the words array: %q", system)
	}
	if len(res.Words) != 2 || res.Words[1].Chinese != "跑" {
		t.Fatalf("got %+v", res)
	}
}
