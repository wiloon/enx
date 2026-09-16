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

	chinese, _, err := b.TranslateSentence(context.Background(), "Hello world")
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

	_, _, err := b.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTranslateWordInContextSuccess(t *testing.T) {
	fake := &fakeConverseClient{output: bedrockTextOutput(`{"word":"银行","why":""}`)}
	b := newTestBedrock(fake)

	res, _, err := b.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank", "n. 银行；水岸")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "银行" {
		t.Fatalf("result: got %+v", res)
	}
}

func TestTranslateWordInContextWhy(t *testing.T) {
	fake := &fakeConverseClient{output: bedrockTextOutput(`{"word":"倾向于","why":"此处是动词 tip 的引申用法，词典只收录了名词义"}`)}
	b := newTestBedrock(fake)

	res, _, err := b.TranslateWordInContext(context.Background(), "The market tips toward recovery.", "tips", "n. 秘诀, 技巧；小贴士, 小窍门")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "倾向于" || res.Why == "" {
		t.Fatalf("result: got %+v", res)
	}
}

// ADR-008: word-in-context is reused as-is for a multi-word phrase (no
// dictionary entry exists for a phrase, so this is the only lookup path).
func TestTranslateWordInContextPhrase(t *testing.T) {
	fake := &fakeConverseClient{output: bedrockTextOutput(`{"word":"找到邮箱地址并联系","why":""}`)}
	b := newTestBedrock(fake)

	res, _, err := b.TranslateWordInContext(
		context.Background(),
		"I'd have to find the right contacts, hunt down emails, and draft outreach.",
		"hunt down emails",
		"",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "找到邮箱地址并联系" {
		t.Fatalf("result: got %+v", res)
	}
}

func TestTranslateWordInContextConverseError(t *testing.T) {
	fake := &fakeConverseClient{err: errors.New("throttled")}
	b := newTestBedrock(fake)

	_, _, err := b.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank", "")
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

	_, _, err := b.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected error for empty content, got nil")
	}
}

func TestNewRequiresModelID(t *testing.T) {
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error when sentence-translate.bedrock.model-id is not set")
	}
}
