// Package bedrock implements aitranslate.Translator against AWS Bedrock
// Runtime's Converse API (default: an Anthropic Claude model).
//
// Credentials come from the AWS SDK's default credential chain, which on an
// EC2 instance resolves automatically via the attached IAM instance role
// (IMDSv2) — no static access key/secret needed. Locally or off-EC2 it falls
// back to AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY. See
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.5.
package bedrock

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/spf13/viper"
)

const (
	requestTimeout = 10 * time.Second

	systemPrompt = "You are a professional English-to-Chinese translator. " +
		"Translate the given English sentence into natural, fluent Chinese. " +
		"Reply with the Chinese translation only, no explanation, no pinyin, no quotes."
)

// converseClient is the minimal surface of *bedrockruntime.Client this
// package needs, so tests can substitute a fake instead of calling AWS.
type converseClient interface {
	Converse(ctx context.Context, params *bedrockruntime.ConverseInput, optFns ...func(*bedrockruntime.Options)) (*bedrockruntime.ConverseOutput, error)
}

type Bedrock struct {
	client  converseClient
	modelID string
}

// New builds a Bedrock translator from config.toml (sentence-translate.bedrock.*)
// and the AWS SDK's default credential chain. It returns an error immediately
// if model-id or a usable AWS region can't be resolved, so a
// "provider = bedrock" misconfiguration is caught at startup rather than on
// the first request. It cannot verify the credentials actually have
// bedrock:InvokeModel permission or that model access has been granted for
// model-id — those surface as an error from the first TranslateSentence call.
func New(ctx context.Context) (*Bedrock, error) {
	modelID := viper.GetString("sentence-translate.bedrock.model-id")
	if modelID == "" {
		return nil, fmt.Errorf("bedrock: sentence-translate.bedrock.model-id is not set")
	}

	var optFns []func(*awsconfig.LoadOptions) error
	if region := viper.GetString("sentence-translate.bedrock.region"); region != "" {
		optFns = append(optFns, awsconfig.WithRegion(region))
	}

	cfg, err := awsconfig.LoadDefaultConfig(ctx, optFns...)
	if err != nil {
		return nil, fmt.Errorf("bedrock: failed to load AWS config: %w", err)
	}
	if cfg.Region == "" {
		return nil, fmt.Errorf("bedrock: AWS region not configured (set sentence-translate.bedrock.region or AWS_REGION)")
	}

	return &Bedrock{
		client:  bedrockruntime.NewFromConfig(cfg),
		modelID: modelID,
	}, nil
}

func (b *Bedrock) TranslateSentence(ctx context.Context, sentence string) (string, error) {
	callCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	out, err := b.client.Converse(callCtx, &bedrockruntime.ConverseInput{
		ModelId: aws.String(b.modelID),
		Messages: []types.Message{
			{
				Role:    types.ConversationRoleUser,
				Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: sentence}},
			},
		},
		System: []types.SystemContentBlock{&types.SystemContentBlockMemberText{Value: systemPrompt}},
	})
	if err != nil {
		return "", fmt.Errorf("bedrock: converse failed: %w", err)
	}

	msg, ok := out.Output.(*types.ConverseOutputMemberMessage)
	if !ok {
		return "", fmt.Errorf("bedrock: unexpected output type %T", out.Output)
	}
	for _, block := range msg.Value.Content {
		if text, ok := block.(*types.ContentBlockMemberText); ok {
			return text.Value, nil
		}
	}
	return "", fmt.Errorf("bedrock: no text content in response")
}
