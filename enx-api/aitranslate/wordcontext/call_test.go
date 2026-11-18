package wordcontext_test

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm/llmtest"
	"enx-api/aitranslate/wordcontext"
)

func TestCallSendsPromptAndParsesReply(t *testing.T) {
	f := &llmtest.Fake{
		Reply: `{"word":"河岸","why":"这里指河边"}`,
		Usage: aiusage.Usage{PromptTokens: 90, CompletionTokens: 20, TotalTokens: 110},
	}

	res, u, err := wordcontext.Call(context.Background(), f.Chat, "We sat on the bank of the river.", "bank", "银行")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "河岸" || res.Why != "这里指河边" {
		t.Fatalf("result: got %+v", res)
	}
	if u != (aiusage.Usage{PromptTokens: 90, CompletionTokens: 20, TotalTokens: 110}) {
		t.Fatalf("usage: got %+v", u)
	}
	want := llmtest.Call{
		Feature:     "translate_word_in_context",
		Temperature: 0.3,
		System:      wordcontext.SystemPrompt,
		User:        "Sentence: We sat on the bank of the river.\nWord: bank\nDictionary definition: 银行",
	}
	if len(f.Calls) != 1 || f.Calls[0] != want {
		t.Fatalf("calls: got %+v, want one %+v", f.Calls, want)
	}
}

func TestCallKeepsUsageWhenChatFails(t *testing.T) {
	f := &llmtest.Fake{Err: errors.New("boom"), Usage: aiusage.Usage{TotalTokens: 7}}

	_, u, err := wordcontext.Call(context.Background(), f.Chat, "s", "w", "")
	if err == nil || err.Error() != "boom" {
		t.Fatalf("error: got %v, want boom", err)
	}
	if u.TotalTokens != 7 {
		t.Fatalf("usage: got %+v", u)
	}
}

func TestCallKeepsUsageWhenReplyDoesNotParse(t *testing.T) {
	f := &llmtest.Fake{Reply: "no json here", Usage: aiusage.Usage{TotalTokens: 9}}

	_, u, err := wordcontext.Call(context.Background(), f.Chat, "s", "w", "")
	if err == nil {
		t.Fatal("want a parse error")
	}
	if u.TotalTokens != 9 {
		t.Fatalf("usage: got %+v", u)
	}
}
