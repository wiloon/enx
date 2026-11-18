// Package deepseek implements aitranslate.Translator against DeepSeek's
// OpenAI-compatible Chat Completions API (https://api.deepseek.com). There is
// no separate "international" vs "China" DeepSeek account/endpoint (unlike
// MiniMax, see minimax.go) -- one api-key, one base URL, used globally.
package deepseek

import (
	"context"
	"enx-api/config"
	"fmt"
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/openaicompat"
	"enx-api/aitranslate/sentence"

	"github.com/go-resty/resty/v2"
)

const (
	// deepseek-flash is DeepSeek-V4.1-Flash (2026-09-10). The older
	// deepseek-chat / deepseek-reasoner names were due to retire on
	// 2026-07-24. Flash thinks by default; chat() turns that off, see
	// thinkingDisabled.
	defaultModel   = "deepseek-flash"
	defaultBaseURL = "https://api.deepseek.com"
)

type DeepSeek struct {
	apiKey string
	model  string
	// rephraseModel is used for the rephrase feature only (ADR-012); empty
	// means "use model". Mirrors kimi's per-feature model override.
	rephraseModel string
	baseURL       string
	client        *resty.Client
}

func (d *DeepSeek) modelForRephrase() string {
	if d.rephraseModel != "" {
		return d.rephraseModel
	}
	return d.model
}

// New builds a DeepSeek translator from config.toml (sentence-translate.deepseek.*)
// and the DEEPSEEK_API_KEY environment variable. It returns an error
// immediately if the API key is missing, so a "provider = deepseek"
// misconfiguration is caught at startup rather than on the first request.
func New(c config.OpenAICompatible, timeout time.Duration) (*DeepSeek, error) {
	apiKey := c.APIKey.Reveal()
	if apiKey == "" {
		return nil, fmt.Errorf("deepseek: DEEPSEEK_API_KEY is not set")
	}

	model := c.Model
	if model == "" {
		model = defaultModel
	}
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &DeepSeek{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: c.RephraseModel,
		baseURL:       baseURL,
		client:        resty.New().SetTimeout(timeout),
	}, nil
}

// thinking is DeepSeek's thinking-mode switch
// (https://api-docs.deepseek.com/guides/thinking_mode). It defaults to on,
// which makes a one-line translation several times slower and ignores
// temperature, so every request sends thinkingDisabled.
type thinking struct {
	Type string `json:"type"`
}

var thinkingDisabled = thinking{Type: "disabled"}

func (d *DeepSeek) TranslateSentence(ctx context.Context, text string) (string, aiusage.Usage, error) {
	return d.chat(ctx, "translate_sentence", d.model, sentence.Temperature, sentence.SystemPrompt, text)
}

func (d *DeepSeek) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	return openaicompat.Chat(ctx, d.client, openaicompat.Endpoint{
		Provider: "deepseek",
		BaseURL:  d.baseURL,
		APIKey:   d.apiKey,
		Extra:    map[string]any{"thinking": thinkingDisabled},
	}, openaicompat.Prompt{Feature: feature, Model: model, Temperature: temperature, System: systemPrompt, User: userContent})
}
