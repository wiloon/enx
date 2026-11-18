package worddef_test

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm/llmtest"
	"enx-api/aitranslate/worddef"
)

func TestCallSendsPromptAndParsesReply(t *testing.T) {
	f := &llmtest.Fake{
		Reply: `{"is_word": true, "quality": 9, "senses": [{"pos": "n.", "zh": "很有魅力的人"}]}`,
		Usage: aiusage.Usage{PromptTokens: 150, CompletionTokens: 40, TotalTokens: 190},
	}

	res, u, err := worddef.Call(context.Background(), f.Chat, "rizzler")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.IsWord || res.Quality != 9 || res.Chinese() != "n. 很有魅力的人" {
		t.Fatalf("result: got %+v", res)
	}
	if u != (aiusage.Usage{PromptTokens: 150, CompletionTokens: 40, TotalTokens: 190}) {
		t.Fatalf("usage: got %+v", u)
	}
	want := llmtest.Call{
		Feature:     "define_word",
		Temperature: 0.2,
		System:      worddef.SystemPrompt,
		User:        "Word: rizzler",
	}
	if len(f.Calls) != 1 || f.Calls[0] != want {
		t.Fatalf("calls: got %+v, want one %+v", f.Calls, want)
	}
}

func TestCallKeepsUsageWhenChatFails(t *testing.T) {
	f := &llmtest.Fake{Err: errors.New("boom"), Usage: aiusage.Usage{TotalTokens: 7}}

	_, u, err := worddef.Call(context.Background(), f.Chat, "w")
	if err == nil || err.Error() != "boom" {
		t.Fatalf("error: got %v, want boom", err)
	}
	if u.TotalTokens != 7 {
		t.Fatalf("usage: got %+v", u)
	}
}

func TestCallKeepsUsageWhenReplyDoesNotParse(t *testing.T) {
	f := &llmtest.Fake{Reply: "no json here", Usage: aiusage.Usage{TotalTokens: 9}}

	_, u, err := worddef.Call(context.Background(), f.Chat, "w")
	if err == nil {
		t.Fatal("want a parse error")
	}
	if u.TotalTokens != 9 {
		t.Fatalf("usage: got %+v", u)
	}
}
