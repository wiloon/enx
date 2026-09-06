package rephrase

import "testing"

func TestParseResultCleanJSON(t *testing.T) {
	raw := `{"idiomatic":"Could you take a look at this when you get a chance?","alternatives":[{"text":"Mind taking a look at this?","register":"casual (Slack DM)"}],"notes":["用 Could you 比 Please help me 更自然，语气更轻。"]}`

	got, err := ParseResult(raw)
	if err != nil {
		t.Fatalf("ParseResult: %v", err)
	}
	if got.Idiomatic != "Could you take a look at this when you get a chance?" {
		t.Fatalf("Idiomatic: got %q", got.Idiomatic)
	}
	if len(got.Alternatives) != 1 ||
		got.Alternatives[0].Text != "Mind taking a look at this?" ||
		got.Alternatives[0].Register != "casual (Slack DM)" {
		t.Fatalf("Alternatives: got %+v", got.Alternatives)
	}
	if len(got.Notes) != 1 || got.Notes[0] != "用 Could you 比 Please help me 更自然，语气更轻。" {
		t.Fatalf("Notes: got %+v", got.Notes)
	}
}

func TestParseResultStripsJSONCodeFence(t *testing.T) {
	raw := "```json\n{\"idiomatic\":\"Can you help me with this?\",\"alternatives\":[{\"text\":\"Could you give me a hand with this?\",\"register\":\"formal\"}],\"notes\":[]}\n```"

	got, err := ParseResult(raw)
	if err != nil {
		t.Fatalf("ParseResult: %v", err)
	}
	if got.Idiomatic != "Can you help me with this?" || len(got.Alternatives) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestParseResultExtractsJSONEmbeddedInProse(t *testing.T) {
	raw := `Sure! Here's a more natural way to say it:

{"idiomatic":"I'll take care of it.","alternatives":[{"text":"I've got this.","register":"casual"}],"notes":["中文的\"我来处理\"直接对应 I'll take care of it。"]}

Hope that helps.`

	got, err := ParseResult(raw)
	if err != nil {
		t.Fatalf("ParseResult: %v", err)
	}
	if got.Idiomatic != "I'll take care of it." || got.Alternatives[0].Text != "I've got this." {
		t.Fatalf("got %+v", got)
	}
}

func TestParseResultRejectsMalformedJSON(t *testing.T) {
	if _, err := ParseResult(`{"idiomatic": "oops", "alternatives": [`); err == nil {
		t.Fatal("expected an error for truncated JSON")
	}
}

func TestParseResultRejectsNoJSONObject(t *testing.T) {
	if _, err := ParseResult("I can't help with that."); err == nil {
		t.Fatal("expected an error when the reply has no JSON object")
	}
}

func TestParseResultRejectsMissingIdiomatic(t *testing.T) {
	raw := `{"alternatives":[{"text":"Could you help?","register":"formal"}],"notes":[]}`
	if _, err := ParseResult(raw); err == nil {
		t.Fatal("expected an error when idiomatic is missing")
	}
}

func TestParseResultRejectsEmptyAlternatives(t *testing.T) {
	raw := `{"idiomatic":"Could you help me with this?","alternatives":[],"notes":[]}`
	if _, err := ParseResult(raw); err == nil {
		t.Fatal("expected an error when there are no alternatives")
	}
}
