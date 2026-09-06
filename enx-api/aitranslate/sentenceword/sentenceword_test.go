package sentenceword

import "testing"

func TestParseResultBareObject(t *testing.T) {
	res, err := ParseResult(`{"sentence":"我在银行存了现金。","word":"银行"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "银行" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultFencedAndPadded(t *testing.T) {
	raw := "Here you go:\n```json\n{\"sentence\": \"你好世界\", \"word\": \"世界\"}\n```\n"
	res, err := ParseResult(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "你好世界" || res.WordChinese != "世界" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultMissingWordIsTolerated(t *testing.T) {
	res, err := ParseResult(`{"sentence":"你好世界"}`)
	if err != nil {
		t.Fatalf("a missing word gloss must not be an error: %v", err)
	}
	if res.SentenceChinese != "你好世界" || res.WordChinese != "" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultEmptyWordIsTolerated(t *testing.T) {
	res, err := ParseResult(`{"sentence":"你好世界","word":"   "}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "" {
		t.Fatalf("whitespace word should trim to empty, got %q", res.WordChinese)
	}
}

func TestParseResultMissingSentenceIsError(t *testing.T) {
	if _, err := ParseResult(`{"word":"银行"}`); err == nil {
		t.Fatal("expected an error when the sentence translation is missing")
	}
}

func TestParseResultNoJSON(t *testing.T) {
	if _, err := ParseResult("sorry, I can't do that"); err == nil {
		t.Fatal("expected an error when the reply has no JSON object")
	}
}

func TestParseResultInvalidJSON(t *testing.T) {
	if _, err := ParseResult(`{"sentence": "你好", `); err == nil {
		t.Fatal("expected an error on malformed JSON")
	}
}
