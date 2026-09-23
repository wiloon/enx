// Package openrouter implements aitranslate.Translator against OpenRouter's
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
	"fmt"
	"strings"

	"enx-api/aitranslate/aicfg"
	"enx-api/aitranslate/aiusage"
	"enx-api/utils/logger"

	"github.com/go-resty/resty/v2"
	"github.com/spf13/viper"
)

const (
	// Override with SENTENCE_TRANSLATE_OPENROUTER_MODEL. OpenRouter model
	// slugs are "vendor/model"; check https://openrouter.ai/models for the
	// current catalog before relying on this default.
	//
	// DeepSeek, not a Western vendor, is a deliberate choice here (2026-09):
	// pinned to the dated v4-flash slug rather than a "latest" alias so the
	// served model doesn't change under us. NOTE this reopens the
	// data-processor question LAUNCH-CHECKLIST §6.2/§6.2c settled by keeping
	// production Bedrock/Claude-only -- routing through OpenRouter does not
	// avoid PIPL/sub-processor disclosure for DeepSeek, it only changes the
	// transport. legal.ts must be updated to disclose DeepSeek as a
	// sub-processor before this ships to real users.
	defaultModel   = "deepseek/deepseek-v4-flash"
	defaultBaseURL = "https://openrouter.ai/api/v1"

	// Sent on every request per OpenRouter's own convention (not required,
	// but it's how they attribute app traffic on their dashboard / rankings).
	// See https://openrouter.ai/docs -- "HTTP-Referer" / "X-Title".
	siteURL  = "https://catglish.com"
	siteName = "Catglish"

	systemPrompt = "You are a professional English-to-Chinese translator. " +
		"Translate the given English sentence into natural, fluent Chinese. " +
		"Reply with the Chinese translation only, no explanation, no pinyin, no quotes."
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

// New builds an OpenRouter translator from config.toml
// (sentence-translate.openrouter.*) and the OPENROUTER_API_KEY environment
// variable. It returns an error immediately if the API key is missing, so a
// "provider = openrouter" misconfiguration is caught at startup rather than
// on the first request.
func New() (*OpenRouter, error) {
	apiKey := viper.GetString("sentence-translate.openrouter.api-key")
	if apiKey == "" {
		return nil, fmt.Errorf("openrouter: OPENROUTER_API_KEY is not set")
	}

	model := viper.GetString("sentence-translate.openrouter.model")
	if model == "" {
		model = defaultModel
	}
	baseURL := viper.GetString("sentence-translate.openrouter.base-url")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	return &OpenRouter{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: viper.GetString("sentence-translate.openrouter.rephrase-model"),
		baseURL:       baseURL,
		client:        resty.New().SetTimeout(aicfg.RequestTimeout()),
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

// usage mirrors the OpenAI-compatible "usage" object OpenRouter returns
// alongside every response, regardless of which upstream vendor served it.
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

func (o *OpenRouter) TranslateSentence(ctx context.Context, sentence string) (string, aiusage.Usage, error) {
	out, u, err := o.chat(ctx, "translate_sentence", o.model, 0.3, systemPrompt, sentence)
	return out, toUsage(u), err
}

func toUsage(u usage) aiusage.Usage {
	return aiusage.Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
}

func (o *OpenRouter) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, usage, error) {
	var result chatResponse
	resp, err := o.client.R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+o.apiKey).
		SetHeader("Content-Type", "application/json").
		SetHeader("HTTP-Referer", siteURL).
		SetHeader("X-Title", siteName).
		SetBody(chatRequest{
			Model: model,
			Messages: []chatMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: userContent},
			},
			Temperature: temperature,
		}).
		SetResult(&result).
		Post(o.baseURL + "/chat/completions")

	if err != nil {
		return "", usage{}, fmt.Errorf("openrouter: request failed: %w", err)
	}
	if resp.StatusCode() != 200 {
		return "", usage{}, fmt.Errorf("openrouter: unexpected status %d: %s", resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", usage{}, fmt.Errorf("openrouter: empty response")
	}

	logger.Infof("aitranslate: usage provider=openrouter feature=%s model=%s input_chars=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d",
		feature, model, len(userContent), result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens)

	return result.Choices[0].Message.Content, result.Usage, nil
}
