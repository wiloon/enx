package rephrase_test

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm/llmtest"
	"enx-api/aitranslate/rephrase"
)

func TestCallSendsPromptAndAttachesUsage(t *testing.T) {
	f := &llmtest.Fake{
		Reply: `{"idiomatic":"Could you take a look?","alternatives":[{"text":"Mind taking a look?","register":"casual"}],"notes":[]}`,
		Usage: aiusage.Usage{PromptTokens: 80, CompletionTokens: 30, TotalTokens: 110},
	}

	res, err := rephrase.Call(context.Background(), f.Chat, "帮我看一下")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Idiomatic != "Could you take a look?" || len(res.Alternatives) != 1 {
		t.Fatalf("result: got %+v", res)
	}
	if res.Usage != (rephrase.Usage{PromptTokens: 80, CompletionTokens: 30, TotalTokens: 110}) {
		t.Fatalf("usage: got %+v", res.Usage)
	}
	want := llmtest.Call{
		Feature:     "rephrase_to_english",
		Temperature: 0.5,
		System:      rephrase.SystemPrompt,
		User:        "帮我看一下",
	}
	if len(f.Calls) != 1 || f.Calls[0] != want {
		t.Fatalf("calls: got %+v, want one %+v", f.Calls, want)
	}
}

// A failed call still hands back its usage, so the caller can bill it
// (ADR-094).
func TestCallReturnsChatErrorWithItsUsage(t *testing.T) {
	f := &llmtest.Fake{Err: errors.New("boom"), Usage: aiusage.Usage{PromptTokens: 80, CompletionTokens: 30, TotalTokens: 110}}

	res, err := rephrase.Call(context.Background(), f.Chat, "x")
	if err == nil || err.Error() != "boom" {
		t.Fatalf("error: got %v, want boom", err)
	}
	if res.Usage != (rephrase.Usage{PromptTokens: 80, CompletionTokens: 30, TotalTokens: 110}) {
		t.Fatalf("usage: got %+v", res.Usage)
	}
}

func TestCallRejectsReplyThatDoesNotParseWithItsUsage(t *testing.T) {
	f := &llmtest.Fake{Reply: "no json here", Usage: aiusage.Usage{PromptTokens: 80, CompletionTokens: 30, TotalTokens: 110}}

	res, err := rephrase.Call(context.Background(), f.Chat, "x")
	if err == nil {
		t.Fatal("want a parse error")
	}
	if res.Usage != (rephrase.Usage{PromptTokens: 80, CompletionTokens: 30, TotalTokens: 110}) {
		t.Fatalf("usage: got %+v", res.Usage)
	}
}
