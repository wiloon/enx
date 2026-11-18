package sentenceword_test

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm/llmtest"
	"enx-api/aitranslate/sentenceword"
)

func TestCallSendsPromptAndParsesReply(t *testing.T) {
	f := &llmtest.Fake{
		Reply: `{"sentence":"我在银行存了现金。","word":"银行"}`,
		Usage: aiusage.Usage{PromptTokens: 120, CompletionTokens: 40, TotalTokens: 160},
	}

	res, u, err := sentenceword.Call(context.Background(), f.Chat, "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "银行" {
		t.Fatalf("result: got %+v", res)
	}
	if u != (aiusage.Usage{PromptTokens: 120, CompletionTokens: 40, TotalTokens: 160}) {
		t.Fatalf("usage: got %+v", u)
	}
	want := llmtest.Call{
		Feature:     "translate_sentence_with_word",
		Temperature: 0.3,
		System:      sentenceword.SystemPrompt,
		User:        "Sentence: I deposited cash at the bank.\nWord: bank",
	}
	if len(f.Calls) != 1 || f.Calls[0] != want {
		t.Fatalf("calls: got %+v, want one %+v", f.Calls, want)
	}
}

func TestCallKeepsUsageWhenChatFails(t *testing.T) {
	f := &llmtest.Fake{Err: errors.New("boom"), Usage: aiusage.Usage{TotalTokens: 7}}

	_, u, err := sentenceword.Call(context.Background(), f.Chat, "s", "w")
	if err == nil || err.Error() != "boom" {
		t.Fatalf("error: got %v, want boom", err)
	}
	if u.TotalTokens != 7 {
		t.Fatalf("usage: got %+v", u)
	}
}

func TestCallKeepsUsageWhenReplyDoesNotParse(t *testing.T) {
	f := &llmtest.Fake{Reply: "no json here", Usage: aiusage.Usage{TotalTokens: 9}}

	_, u, err := sentenceword.Call(context.Background(), f.Chat, "s", "w")
	if err == nil {
		t.Fatal("want a parse error")
	}
	if u.TotalTokens != 9 {
		t.Fatalf("usage: got %+v", u)
	}
}
