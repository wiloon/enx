// Package kimi implements aitranslate.Translator against Moonshot AI's
// Kimi Chat Completions API (OpenAI-compatible request/response format).
package kimi

import (
	"context"
	"enx-api/config"
	"fmt"
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/openaicompat"
	"enx-api/aitranslate/sentence"

	"github.com/go-resty/resty/v2"
)

const (
	defaultModel   = "moonshot-v1-8k"
	defaultBaseURL = "https://api.moonshot.cn/v1"
)

type Kimi struct {
	apiKey string
	model  string
	// rephraseModel is used for the rephrase feature only (ADR-012); empty
	// means "use model". Rephrase output is longer than a translation and
	// the input cap will grow, so a deployment can point rephrase at a
	// larger-context model without changing translation.
	rephraseModel string
	baseURL       string
	client        *resty.Client
}

func (k *Kimi) modelForRephrase() string {
	if k.rephraseModel != "" {
		return k.rephraseModel
	}
	return k.model
}

// New builds a Kimi translator from config.toml (sentence-translate.kimi.*)
// and the KIMI_API_KEY environment variable. It returns an error immediately
// if the API key is missing, so a "provider = kimi" misconfiguration is
// caught at startup rather than on the first request.
func New(c config.OpenAICompatible, timeout time.Duration) (*Kimi, error) {
	apiKey := c.APIKey.Reveal()
	if apiKey == "" {
		return nil, fmt.Errorf("kimi: KIMI_API_KEY is not set")
	}

	model := c.Model
	if model == "" {
		model = defaultModel
	}
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &Kimi{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: c.RephraseModel,
		baseURL:       baseURL,
		client:        resty.New().SetTimeout(timeout),
	}, nil
}

func (k *Kimi) TranslateSentence(ctx context.Context, text string) (string, aiusage.Usage, error) {
	return k.chat(ctx, "translate_sentence", k.model, sentence.Temperature, sentence.SystemPrompt, text)
}

func (k *Kimi) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	return openaicompat.Chat(ctx, k.client, openaicompat.Endpoint{
		Provider: "kimi",
		BaseURL:  k.baseURL,
		APIKey:   k.apiKey,
	}, openaicompat.Prompt{Feature: feature, Model: model, Temperature: temperature, System: systemPrompt, User: userContent})
}

// chatWith binds chat to one model, giving the feature packages the
// llm.Chat they call.
func (k *Kimi) chatWith(model string) llm.Chat {
	return func(ctx context.Context, feature string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
		return k.chat(ctx, feature, model, temperature, systemPrompt, userContent)
	}
}
