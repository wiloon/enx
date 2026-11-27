// Package openrouter offers the AI provider's chats on OpenRouter's
// OpenAI-compatible Chat Completions API
// (https://openrouter.ai/api/v1/chat/completions). Auth is an OpenRouter API
// key (https://openrouter.ai/settings/keys), sent as Authorization: Bearer --
// the same shape as gemini/kimi/deepseek. OpenRouter is a single endpoint
// that can route to many upstream model vendors by "model" string
// (vendor/model, e.g. "anthropic/claude-haiku-4.5"), so this provider is a
// pragmatic way to get a translation/rephrase provider live without waiting
// on a vendor-specific access gate (see adr-031 revision history and the
// Bedrock Anthropic use-case-details gate it hit at launch).
package openrouter

import (
	"context"
	"enx-api/config"
	"fmt"
	"strings"
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/openaicompat"

	"github.com/go-resty/resty/v2"
)

const (
	// Override with SENTENCE_TRANSLATE_OPENROUTER_MODEL. OpenRouter model
	// slugs are "vendor/model"; check https://openrouter.ai/models for the
	// current catalog before relying on this default.
	//
	// DeepSeek, not a Western vendor, is a deliberate choice here (2026-09):
	// pinned to a versioned slug rather than a "latest" alias so the served
	// model doesn't change under us. v4.1-flash since 2026-10: DeepSeek
	// retired V4-Flash on 2026-09-10. NOTE this reopens the
	// data-processor question LAUNCH-CHECKLIST §6.2/§6.2c settled by keeping
	// production Bedrock/Claude-only -- routing through OpenRouter does not
	// avoid PIPL/sub-processor disclosure for DeepSeek, it only changes the
	// transport. legal.ts must be updated to disclose DeepSeek as a
	// sub-processor before this ships to real users.
	defaultModel   = "deepseek/deepseek-v4.1-flash"
	defaultBaseURL = "https://openrouter.ai/api/v1"

	// Sent on every request per OpenRouter's own convention (not required,
	// but it's how they attribute app traffic on their dashboard / rankings).
	// See https://openrouter.ai/docs -- "HTTP-Referer" / "X-Title".
	siteURL  = "https://catglish.com"
	siteName = "Catglish"
)

type OpenRouter struct {
	apiKey string
	model  string
	// rephraseModel is used for the rephrase feature only (ADR-012); empty
	// means "use model". Mirrors gemini/kimi/deepseek's per-feature override.
	rephraseModel string
	baseURL       string
	client        *resty.Client
}

func (o *OpenRouter) modelForRephrase() string {
	if o.rephraseModel != "" {
		return o.rephraseModel
	}
	return o.model
}

// New builds an OpenRouter client from config.toml
// (sentence-translate.openrouter.*) and the OPENROUTER_API_KEY environment
// variable. It returns an error immediately if the API key is missing, so a
// "provider = openrouter" misconfiguration is caught at startup rather than
// on the first request.
func New(c config.OpenAICompatible, timeout time.Duration) (*OpenRouter, error) {
	apiKey := c.APIKey.Reveal()
	if apiKey == "" {
		return nil, fmt.Errorf("openrouter: OPENROUTER_API_KEY is not set")
	}

	model := c.Model
	if model == "" {
		model = defaultModel
	}
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	return &OpenRouter{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: c.RephraseModel,
		baseURL:       baseURL,
		client:        resty.New().SetTimeout(timeout),
	}, nil
}

// reasoning is OpenRouter's reasoning switch
// (https://openrouter.ai/docs/use-cases/reasoning-tokens). Models that
// support reasoning use it by default (deepseek-v4.1-flash: effort high),
// which makes a one-line translation several times slower, so every request
// sends reasoningDisabled. A model whose reasoning is mandatory rejects it.
type reasoning struct {
	Enabled bool `json:"enabled"`
}

var reasoningDisabled = reasoning{Enabled: false}

func (o *OpenRouter) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	return openaicompat.Chat(ctx, o.client, openaicompat.Endpoint{
		Provider: "openrouter",
		BaseURL:  o.baseURL,
		APIKey:   o.apiKey,
		Headers:  map[string]string{"HTTP-Referer": siteURL, "X-Title": siteName},
		Extra:    map[string]any{"reasoning": reasoningDisabled},
	}, openaicompat.Prompt{Feature: feature, Model: model, Temperature: temperature, System: systemPrompt, User: userContent})
}

// Chat is the llm.Chat for every feature except rephrase.
func (o *OpenRouter) Chat(ctx context.Context, feature string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	return o.chat(ctx, feature, o.model, temperature, systemPrompt, userContent)
}

// RephraseChat is the llm.Chat for rephrase, on the rephrase model (ADR-012).
func (o *OpenRouter) RephraseChat(ctx context.Context, feature string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	return o.chat(ctx, feature, o.modelForRephrase(), temperature, systemPrompt, userContent)
}
