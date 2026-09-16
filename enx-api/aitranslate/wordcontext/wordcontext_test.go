package wordcontext

import "testing"

func TestParseResultBareObject(t *testing.T) {
	res, err := ParseResult(`{"word":"银行","why":""}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "银行" || res.Why != "" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultWithWhy(t *testing.T) {
	res, err := ParseResult(`{"word":"倾向于","why":"此处是动词 tip 的引申用法，词典只收录了名词义"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "倾向于" || res.Why == "" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultFencedAndPadded(t *testing.T) {
	raw := "Here you go:\n```json\n{\"word\": \"世界\", \"why\": \"\"}\n```\n"
	res, err := ParseResult(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "世界" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultMissingWhyIsTolerated(t *testing.T) {
	res, err := ParseResult(`{"word":"银行"}`)
	if err != nil {
		t.Fatalf("a missing why must not be an error: %v", err)
	}
	if res.WordChinese != "银行" || res.Why != "" {
		t.Fatalf("got %+v", res)
	}
}

func TestParseResultEmptyWordIsError(t *testing.T) {
	if _, err := ParseResult(`{"word":"   ","why":""}`); err == nil {
		t.Fatal("expected an error when the word gloss is missing")
	}
}

func TestParseResultMissingWordIsError(t *testing.T) {
	if _, err := ParseResult(`{"why":"some reason"}`); err == nil {
		t.Fatal("expected an error when the word gloss is missing")
	}
}

func TestParseResultNoJSON(t *testing.T) {
	if _, err := ParseResult("sorry, I can't do that"); err == nil {
		t.Fatal("expected an error when the reply has no JSON object")
	}
}

func TestParseResultInvalidJSON(t *testing.T) {
	if _, err := ParseResult(`{"word": "银行", `); err == nil {
		t.Fatal("expected an error on malformed JSON")
	}
}

// Mirrors sentenceword's fallback recovery for a dropped comma between
// fields, since both packages share the same lenient parsing rationale.
func TestParseResultRecoversFromMissingCommaBetweenFields(t *testing.T) {
	raw := `{"word": "自主的" Additional thoughts here, "why": "习语用法"}`
	res, err := ParseResult(raw)
	if err != nil {
		t.Fatalf("expected fallback recovery, got error: %v", err)
	}
	if res.WordChinese != "自主的" || res.Why != "习语用法" {
		t.Fatalf("got %+v", res)
	}
}

func TestBuildUserContentOmitsDictionaryWhenEmpty(t *testing.T) {
	content := BuildUserContent("I deposited cash at the bank.", "bank", "")
	if content != "Sentence: I deposited cash at the bank.\nWord: bank" {
		t.Fatalf("got %q", content)
	}
}

func TestBuildUserContentIncludesDictionaryWhenPresent(t *testing.T) {
	content := BuildUserContent("The market tips toward recovery.", "tips", "n. 秘诀, 技巧；小贴士, 小窍门")
	want := "Sentence: The market tips toward recovery.\nWord: tips\nDictionary definition: n. 秘诀, 技巧；小贴士, 小窍门"
	if content != want {
		t.Fatalf("got %q want %q", content, want)
	}
}
