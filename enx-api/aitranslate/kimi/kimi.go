// Package kimi implements aitranslate.Translator against Moonshot AI's
// Kimi Chat Completions API (OpenAI-compatible request/response format).
package kimi

import (
	"context"
	"fmt"
	"time"

	"enx-api/utils/logger"

	"github.com/go-resty/resty/v2"
	"github.com/spf13/viper"
)

const (
	defaultModel   = "moonshot-v1-8k"
	defaultBaseURL = "https://api.moonshot.cn/v1"
	requestTimeout = 10 * time.Second

	systemPrompt = "You are a professional English-to-Chinese translator. " +
		"Translate the given English sentence into natural, fluent Chinese. " +
		"Reply with the Chinese translation only, no explanation, no pinyin, no quotes."

	wordContextSystemPrompt = "You are a professional English-to-Chinese translator. " +
		"Given an English sentence and a specific word or phrase from that sentence, reply with " +
		"its Chinese meaning as used in THIS sentence's context only, not a generic " +
		"dictionary definition. Reply with the Chinese meaning only, no explanation, no pinyin, no quotes."
)

type Kimi struct {
	apiKey  string
	model   string
	baseURL string
	client  *resty.Client
}

// New builds a Kimi translator from config.toml (sentence-translate.kimi.*)
// and the KIMI_API_KEY environment variable. It returns an error immediately
// if the API key is missing, so a "provider = kimi" misconfiguration is
// caught at startup rather than on the first request.
func New() (*Kimi, error) {
	apiKey := viper.GetString("sentence-translate.kimi.api-key")
	if apiKey == "" {
		return nil, fmt.Errorf("kimi: KIMI_API_KEY is not set")
	}

	model := viper.GetString("sentence-translate.kimi.model")
	if model == "" {
		model = defaultModel
	}
	baseURL := viper.GetString("sentence-translate.kimi.base-url")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &Kimi{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		client:  resty.New().SetTimeout(requestTimeout),
	}, nil
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
}

// usage mirrors the OpenAI-compatible "usage" object Kimi's Chat Completions
// API returns alongside every response. Logged (not yet acted on) so real
// token counts can be measured before deciding the token->credit
// conversion ratio and the translate_sentence vs translate_word_in_context
// cost split -- see docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md
// §4.1's "具体数值待定". word-in-context sends the same sentence as context
// plus the target word, so PromptTokens should be close to (not equal to)
// translate_sentence's for the same sentence -- CompletionTokens is where
// the two are expected to actually diverge (a full translated sentence vs.
// one word's gloss).
type usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Usage usage `json:"usage"`
}

func (k *Kimi) TranslateSentence(ctx context.Context, sentence string) (string, error) {
	return k.chat(ctx, "translate_sentence", systemPrompt, sentence)
}

func (k *Kimi) TranslateWordInContext(ctx context.Context, sentence, word string) (string, error) {
	return k.chat(ctx, "translate_word_in_context", wordContextSystemPrompt, fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word))
}

func (k *Kimi) chat(ctx context.Context, feature, systemPrompt, userContent string) (string, error) {
	var result chatResponse
	resp, err := k.client.R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+k.apiKey).
		SetHeader("Content-Type", "application/json").
		SetBody(chatRequest{
			Model: k.model,
			Messages: []chatMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: userContent},
			},
			Temperature: 0.3,
		}).
		SetResult(&result).
		Post(k.baseURL + "/chat/completions")

	if err != nil {
		return "", fmt.Errorf("kimi: request failed: %w", err)
	}
	if resp.StatusCode() != 200 {
		return "", fmt.Errorf("kimi: unexpected status %d: %s", resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("kimi: empty response")
	}

	logger.Infof("aitranslate: usage provider=kimi feature=%s model=%s input_chars=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d",
		feature, k.model, len(userContent), result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens)

	return result.Choices[0].Message.Content, nil
}
