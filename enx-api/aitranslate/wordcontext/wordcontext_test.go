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

// A chatty model can drop the comma between fields and add a stray remark;
// each field's own value is still intact, so both are recovered.
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

// #1136: word and why are only ever taken from the reply's top-level
// object. A word gloss found only inside a nested object, past the root's
// close, as a string value, or in a root that never closes is not the
// model's answer for this word, so the reply is a parse error.
func TestParseResultRejectsWordNotAtTopLevel(t *testing.T) {
	cases := map[string]string{
		"nested in valid JSON":              `{"metadata":{"word":"银行"}}`,
		"word is an object":                 `{"word":{"word":"银行"}}`,
		"nested in malformed JSON":          `{"metadata":{"word":"银行"} oops}`,
		"nested before empty top-level":     `{"data":{"word":"银行"},"word":""}`,
		"second object after a stray brace": `{"a":1}} {"x":{"word":"银行"}}`,
		"root not closed":                   `{"metadata":{"word":"银行"}`,
		"word as a string value":            `{"note":"word":"银行"}`,
		"root not closed with nested why":   `{"word":"银行","extra":{"why":"x"}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if res, err := ParseResult(raw); err == nil {
				t.Fatalf("ParseResult(%s): expected an error, got %+v", raw, res)
			}
		})
	}
}

// Already green before #1136 only because the regex hit the empty
// top-level "word" first; kept as a guard against key-order luck.
func TestParseResultEmptyTopLevelWordWithNestedWordIsError(t *testing.T) {
	if res, err := ParseResult(`{"word":"","data":{"word":"银行"}}`); err == nil {
		t.Fatalf("expected an error, got %+v", res)
	}
}

// Recovery from a malformed reply keeps the top-level word but never
// attaches a why that sits inside a nested object.
func TestParseResultRecoveryIgnoresNestedWhy(t *testing.T) {
	res, err := ParseResult(`{"word":"银行" oops, "extra":{"why":"x"}}`)
	if err != nil {
		t.Fatalf("expected recovery, got error: %v", err)
	}
	if res.WordChinese != "银行" || res.Why != "" {
		t.Fatalf("got %+v", res)
	}
}

// An escaped backslash right before the closing quote ends the string;
// recovery still finds both fields. Already green before #1136.
func TestParseResultRecoveryHandlesEscapedBackslash(t *testing.T) {
	res, err := ParseResult(`{"word":"a\\" oops, "why":"y"}`)
	if err != nil {
		t.Fatalf("expected recovery, got error: %v", err)
	}
	if res.WordChinese != `a\` || res.Why != "y" {
		t.Fatalf("got %+v", res)
	}
}
