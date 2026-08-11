// Package kimi implements aitranslate.Translator against Moonshot AI's
// Kimi Chat Completions API (OpenAI-compatible request/response format).
package kimi

import (
	"context"
	"fmt"
	"time"

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

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

func (k *Kimi) TranslateSentence(ctx context.Context, sentence string) (string, error) {
	return k.chat(ctx, systemPrompt, sentence)
}

func (k *Kimi) TranslateWordInContext(ctx context.Context, sentence, word string) (string, error) {
	return k.chat(ctx, wordContextSystemPrompt, fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word))
}

func (k *Kimi) chat(ctx context.Context, systemPrompt, userContent string) (string, error) {
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
	return result.Choices[0].Message.Content, nil
}
