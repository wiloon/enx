package bedrock

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

func bedrockTextOutput(text string) *bedrockruntime.ConverseOutput {
	return &bedrockruntime.ConverseOutput{
		Output: &types.ConverseOutputMemberMessage{
			Value: types.Message{
				Role:    types.ConversationRoleAssistant,
				Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: text}},
			},
		},
	}
}

func TestTranslateSentenceWithWordSuccess(t *testing.T) {
	fake := &fakeConverseClient{output: bedrockTextOutput(`{"sentence":"我在银行存了现金。","word":"银行"}`)}
	b := newTestBedrock(fake)

	res, _, err := b.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "银行" {
		t.Fatalf("result: got %+v", res)
	}
}

func TestTranslateSentenceWithWordMissingWordGloss(t *testing.T) {
	fake := &fakeConverseClient{output: bedrockTextOutput(`{"sentence":"我在银行存了现金。"}`)}
	b := newTestBedrock(fake)

	res, _, err := b.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "" {
		t.Fatalf("result: got %+v", res)
	}
}

func TestTranslateSentenceWithWordConverseError(t *testing.T) {
	fake := &fakeConverseClient{err: errors.New("throttled")}
	b := newTestBedrock(fake)

	if _, _, err := b.TranslateSentenceWithWord(context.Background(), "s", "w"); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTranslateSentenceWithWordUnparseable(t *testing.T) {
	fake := &fakeConverseClient{output: bedrockTextOutput("sorry, I can't")}
	b := newTestBedrock(fake)

	if _, _, err := b.TranslateSentenceWithWord(context.Background(), "s", "w"); err == nil {
		t.Fatal("expected a parse error to propagate, got nil")
	}
}
