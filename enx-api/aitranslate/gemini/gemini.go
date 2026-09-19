// Package gemini implements aitranslate.Translator against Gemini's
// OpenAI-compatible Chat Completions API
// (https://generativelanguage.googleapis.com/v1beta/openai/). Auth is a
// Gemini API key from Google AI Studio (https://aistudio.google.com/apikey),
// sent as Authorization: Bearer — the same shape as kimi/deepseek.
package gemini

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
	// gemini-3.6-flash is the current Flash tier for new AI Studio /
	// Generative Language API users (2.5-flash returns 404 for new keys).
	// Override with SENTENCE_TRANSLATE_GEMINI_MODEL.
	defaultModel   = "gemini-3.6-flash"
	defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai"

	systemPrompt = "You are a professional English-to-Chinese translator. " +
		"Translate the given English sentence into natural, fluent Chinese. " +
		"Reply with the Chinese translation only, no explanation, no pinyin, no quotes."
)

type Gemini struct {
	apiKey string
	model  string
	// rephraseModel is used for the rephrase feature only (ADR-012); empty
	// means "use model". Mirrors kimi/deepseek's per-feature override.
	rephraseModel string
	baseURL       string
	client        *resty.Client
}

func (g *Gemini) modelForRephrase() string {
	if g.rephraseModel != "" {
		return g.rephraseModel
	}
	return g.model
}

// New builds a Gemini translator from config.toml (sentence-translate.gemini.*)
// and the GEMINI_API_KEY environment variable. It returns an error
// immediately if the API key is missing, so a "provider = gemini"
// misconfiguration is caught at startup rather than on the first request.
func New() (*Gemini, error) {
	apiKey := viper.GetString("sentence-translate.gemini.api-key")
	if apiKey == "" {
		return nil, fmt.Errorf("gemini: GEMINI_API_KEY is not set")
	}

	model := viper.GetString("sentence-translate.gemini.model")
	if model == "" {
		model = defaultModel
	}
	baseURL := viper.GetString("sentence-translate.gemini.base-url")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	return &Gemini{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: viper.GetString("sentence-translate.gemini.rephrase-model"),
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

// usage mirrors the OpenAI-compatible "usage" object Gemini's Chat
// Completions compatibility layer returns alongside every response.
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

func (g *Gemini) TranslateSentence(ctx context.Context, sentence string) (string, aiusage.Usage, error) {
	out, u, err := g.chat(ctx, "translate_sentence", g.model, 0.3, systemPrompt, sentence)
	return out, toUsage(u), err
}

func toUsage(u usage) aiusage.Usage {
	return aiusage.Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
}

func (g *Gemini) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, usage, error) {
	var result chatResponse
	resp, err := g.client.R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+g.apiKey).
		SetHeader("Content-Type", "application/json").
		SetBody(chatRequest{
			Model: model,
			Messages: []chatMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: userContent},
			},
			Temperature: temperature,
		}).
		SetResult(&result).
		Post(g.baseURL + "/chat/completions")

	if err != nil {
		return "", usage{}, fmt.Errorf("gemini: request failed: %w", err)
	}
	if resp.StatusCode() != 200 {
		return "", usage{}, fmt.Errorf("gemini: unexpected status %d: %s", resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", usage{}, fmt.Errorf("gemini: empty response")
	}

	logger.Infof("aitranslate: usage provider=gemini feature=%s model=%s input_chars=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d",
		feature, model, len(userContent), result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens)

	return result.Choices[0].Message.Content, result.Usage, nil
}
