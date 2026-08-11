// Package minimax implements aitranslate.Translator against MiniMax's
// OpenAI-compatible Chat Completions API (https://api.minimax.io/v1/chat/completions).
// MiniMax's older ChatCompletion Pro API required a group_id query parameter;
// the current OpenAI-compatible endpoint does not, so GroupID below is kept
// optional for forward/backward compatibility rather than required.
package minimax

import (
	"context"
	"fmt"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/spf13/viper"
)

const (
	defaultModel   = "MiniMax-Text-01"
	defaultBaseURL = "https://api.minimax.io/v1"
	requestTimeout = 10 * time.Second

	systemPrompt = "You are a professional English-to-Chinese translator. " +
		"Translate the given English sentence into natural, fluent Chinese. " +
		"Reply with the Chinese translation only, no explanation, no pinyin, no quotes."

	wordContextSystemPrompt = "You are a professional English-to-Chinese translator. " +
		"Given an English sentence and a specific word or phrase from that sentence, reply with " +
		"its Chinese meaning as used in THIS sentence's context only, not a generic " +
		"dictionary definition. Reply with the Chinese meaning only, no explanation, no pinyin, no quotes."
)

type MiniMax struct {
	apiKey  string
	model   string
	baseURL string
	groupID string
	client  *resty.Client
}

// New builds a MiniMax translator from config.toml (sentence-translate.minimax.*)
// and the MINIMAX_API_KEY environment variable. It returns an error
// immediately if the API key is missing, so a "provider = minimax"
// misconfiguration is caught at startup rather than on the first request.
func New() (*MiniMax, error) {
	apiKey := viper.GetString("sentence-translate.minimax.api-key")
	if apiKey == "" {
		return nil, fmt.Errorf("minimax: MINIMAX_API_KEY is not set")
	}

	model := viper.GetString("sentence-translate.minimax.model")
	if model == "" {
		model = defaultModel
	}
	baseURL := viper.GetString("sentence-translate.minimax.base-url")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &MiniMax{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		groupID: viper.GetString("sentence-translate.minimax.group-id"),
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

func (m *MiniMax) TranslateSentence(ctx context.Context, sentence string) (string, error) {
	return m.chat(ctx, systemPrompt, sentence)
}

func (m *MiniMax) TranslateWordInContext(ctx context.Context, sentence, word string) (string, error) {
	return m.chat(ctx, wordContextSystemPrompt, fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word))
}

func (m *MiniMax) chat(ctx context.Context, systemPrompt, userContent string) (string, error) {
	req := m.client.R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+m.apiKey).
		SetHeader("Content-Type", "application/json")

	if m.groupID != "" {
		req.SetQueryParam("GroupId", m.groupID)
	}

	var result chatResponse
	resp, err := req.
		SetBody(chatRequest{
			Model: m.model,
			Messages: []chatMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: userContent},
			},
			Temperature: 0.3,
		}).
		SetResult(&result).
		Post(m.baseURL + "/chat/completions")

	if err != nil {
		return "", fmt.Errorf("minimax: request failed: %w", err)
	}
	if resp.StatusCode() != 200 {
		return "", fmt.Errorf("minimax: unexpected status %d: %s", resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("minimax: empty response")
	}
	return result.Choices[0].Message.Content, nil
}
