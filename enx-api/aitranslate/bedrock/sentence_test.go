package bedrock

import (
	"context"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

type recordingConverseClient struct {
	input *bedrockruntime.ConverseInput
}

func (r *recordingConverseClient) Converse(ctx context.Context, params *bedrockruntime.ConverseInput, optFns ...func(*bedrockruntime.Options)) (*bedrockruntime.ConverseOutput, error) {
	r.input = params
	return &bedrockruntime.ConverseOutput{
		Output: &types.ConverseOutputMemberMessage{
			Value: types.Message{
				Role:    types.ConversationRoleAssistant,
				Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "你好世界"}},
			},
		},
	}, nil
}

func TestTranslateSentenceAsksForSimplifiedChinese(t *testing.T) {
	rec := &recordingConverseClient{}
	if _, _, err := newTestBedrock(rec).TranslateSentence(context.Background(), "Hello world"); err != nil {
		t.Fatalf("TranslateSentence: %v", err)
	}
	if len(rec.input.System) == 0 {
		t.Fatal("no system prompt sent")
	}
	text, ok := rec.input.System[0].(*types.SystemContentBlockMemberText)
	if !ok {
		t.Fatalf("system block is %T, want text", rec.input.System[0])
	}
	if !strings.Contains(text.Value, "Simplified Chinese") {
		t.Errorf("system prompt does not ask for Simplified Chinese:\n%s", text.Value)
	}
}
