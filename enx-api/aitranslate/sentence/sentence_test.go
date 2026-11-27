package sentence

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm/llmtest"
)

// The reply comes back unchecked: the caller runs Check on it.
func TestCallSendsThePromptAndReturnsTheReplyUnchecked(t *testing.T) {
	usage := aiusage.Usage{PromptTokens: 7, CompletionTokens: 3, TotalTokens: 10}
	fake := &llmtest.Fake{Reply: "  ", Usage: usage}

	got, u, err := Call(context.Background(), fake.Chat, "Hello.")

	if err != nil || got != "  " || u != usage {
		t.Errorf("Call = %q, %+v, %v, want the reply and usage unchanged", got, u, err)
	}
	want := llmtest.Call{Feature: "translate_sentence", Temperature: Temperature, System: SystemPrompt, User: "Hello."}
	if len(fake.Calls) != 1 || fake.Calls[0] != want {
		t.Errorf("calls = %+v, want %+v", fake.Calls, want)
	}
}

func TestCheckRejectsABlankTranslation(t *testing.T) {
	for _, raw := range []string{"", "   ", "\n\t"} {
		if err := Check(raw); !errors.Is(err, ErrEmptyTranslation) {
			t.Errorf("Check(%q) = %v, want ErrEmptyTranslation", raw, err)
		}
	}
}

func TestCheckAcceptsATranslation(t *testing.T) {
	for _, raw := range []string{"你好", " 你好 "} {
		if err := Check(raw); err != nil {
			t.Errorf("Check(%q) = %v, want nil", raw, err)
		}
	}
}
