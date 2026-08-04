package bedrock

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

type fakeConverseClient struct {
	output *bedrockruntime.ConverseOutput
	err    error
}

func (f *fakeConverseClient) Converse(ctx context.Context, params *bedrockruntime.ConverseInput, optFns ...func(*bedrockruntime.Options)) (*bedrockruntime.ConverseOutput, error) {
	return f.output, f.err
}

func newTestBedrock(client converseClient) *Bedrock {
	return &Bedrock{client: client, modelID: "anthropic.claude-3-5-haiku-20241022-v1:0"}
}

func TestTranslateSentenceSuccess(t *testing.T) {
	fake := &fakeConverseClient{
		output: &bedrockruntime.ConverseOutput{
			Output: &types.ConverseOutputMemberMessage{
				Value: types.Message{
					Role:    types.ConversationRoleAssistant,
					Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "你好世界"}},
				},
			},
		},
	}
	b := newTestBedrock(fake)

	chinese, err := b.TranslateSentence(context.Background(), "Hello world")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if chinese != "你好世界" {
		t.Fatalf("chinese: got %q", chinese)
	}
}

func TestTranslateSentenceConverseError(t *testing.T) {
	fake := &fakeConverseClient{err: errors.New("throttled")}
	b := newTestBedrock(fake)

	_, err := b.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTranslateWordInContextSuccess(t *testing.T) {
	fake := &fakeConverseClient{
		output: &bedrockruntime.ConverseOutput{
			Output: &types.ConverseOutputMemberMessage{
				Value: types.Message{
					Role:    types.ConversationRoleAssistant,
					Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "银行"}},
				},
			},
		},
	}
	b := newTestBedrock(fake)

	chinese, err := b.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if chinese != "银行" {
		t.Fatalf("chinese: got %q", chinese)
	}
}

func TestTranslateWordInContextConverseError(t *testing.T) {
	fake := &fakeConverseClient{err: errors.New("throttled")}
	b := newTestBedrock(fake)

	_, err := b.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTranslateSentenceNoTextContent(t *testing.T) {
	fake := &fakeConverseClient{
		output: &bedrockruntime.ConverseOutput{
			Output: &types.ConverseOutputMemberMessage{
				Value: types.Message{Role: types.ConversationRoleAssistant},
			},
		},
	}
	b := newTestBedrock(fake)

	_, err := b.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected error for empty content, got nil")
	}
}

func TestNewRequiresModelID(t *testing.T) {
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error when sentence-translate.bedrock.model-id is not set")
	}
}
