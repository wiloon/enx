// Package openaicompat sends one prompt to an OpenAI-compatible Chat
// Completions endpoint. The kimi, deepseek, gemini, openrouter and minimax
// providers share it and add only what their API needs on top.
package openaicompat

import (
	"context"
	"fmt"

	"enx-api/aitranslate/aiusage"
	"enx-api/utils/logger"

	"github.com/go-resty/resty/v2"
)

// Endpoint is one provider's Chat Completions API.
type Endpoint struct {
	// Provider names the provider in errors and in the usage log line.
	Provider string
	BaseURL  string
	APIKey   string
	// Headers are sent besides Authorization and Content-Type.
	Headers map[string]string
	Query   map[string]string
	// Extra holds body fields besides model, messages and temperature, such
	// as a switch that turns the model's thinking off.
	Extra map[string]any
}

// Prompt is one system plus user message pair.
type Prompt struct {
	// Feature names the calling feature in the usage log line.
	Feature     string
	Model       string
	Temperature float64
	System      string
	User        string
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type response struct {
	Choices []struct {
		Message message `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// Chat posts p to e's /chat/completions and returns the first choice's
// content with the token usage the API reported. The usage comes back zero
// when the request fails.
func Chat(ctx context.Context, client *resty.Client, e Endpoint, p Prompt) (string, aiusage.Usage, error) {
	body := map[string]any{
		"model": p.Model,
		"messages": []message{
			{Role: "system", Content: p.System},
			{Role: "user", Content: p.User},
		},
		"temperature": p.Temperature,
	}
	for k, v := range e.Extra {
		body[k] = v
	}

	var result response
	resp, err := client.R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+e.APIKey).
		SetHeader("Content-Type", "application/json").
		SetHeaders(e.Headers).
		SetQueryParams(e.Query).
		SetBody(body).
		SetResult(&result).
		Post(e.BaseURL + "/chat/completions")

	if err != nil {
		return "", aiusage.Usage{}, fmt.Errorf("%s: request failed: %w", e.Provider, err)
	}
	if resp.StatusCode() != 200 {
		return "", aiusage.Usage{}, fmt.Errorf("%s: unexpected status %d: %s", e.Provider, resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", aiusage.Usage{}, fmt.Errorf("%s: empty response", e.Provider)
	}

	u := aiusage.Usage{
		PromptTokens:     result.Usage.PromptTokens,
		CompletionTokens: result.Usage.CompletionTokens,
		TotalTokens:      result.Usage.TotalTokens,
	}
	logger.Infof("aitranslate: usage provider=%s feature=%s model=%s input_chars=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d",
		e.Provider, p.Feature, p.Model, len(p.User), u.PromptTokens, u.CompletionTokens, u.TotalTokens)

	return result.Choices[0].Message.Content, u, nil
}
