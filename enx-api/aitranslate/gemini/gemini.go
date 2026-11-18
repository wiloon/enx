// Package gemini implements aitranslate.Translator against Gemini's
// OpenAI-compatible Chat Completions API
// (https://generativelanguage.googleapis.com/v1beta/openai/). Auth is a
// Gemini API key from Google AI Studio (https://aistudio.google.com/apikey),
// sent as Authorization: Bearer — the same shape as kimi/deepseek.
package gemini

import (
	"context"
	"enx-api/config"
	"fmt"
	"strings"
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/openaicompat"
	"enx-api/aitranslate/sentence"

	"github.com/go-resty/resty/v2"
)

const (
	// gemini-3.6-flash is the current Flash tier for new AI Studio /
	// Generative Language API users (2.5-flash returns 404 for new keys).
	// Override with SENTENCE_TRANSLATE_GEMINI_MODEL.
	defaultModel   = "gemini-3.6-flash"
	defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai"
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
func New(c config.OpenAICompatible, timeout time.Duration) (*Gemini, error) {
	apiKey := c.APIKey.Reveal()
	if apiKey == "" {
		return nil, fmt.Errorf("gemini: GEMINI_API_KEY is not set")
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

	return &Gemini{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: c.RephraseModel,
		baseURL:       baseURL,
		client:        resty.New().SetTimeout(timeout),
	}, nil
}

func (g *Gemini) TranslateSentence(ctx context.Context, text string) (string, aiusage.Usage, error) {
	return g.chat(ctx, "translate_sentence", g.model, sentence.Temperature, sentence.SystemPrompt, text)
}

func (g *Gemini) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	return openaicompat.Chat(ctx, g.client, openaicompat.Endpoint{
		Provider: "gemini",
		BaseURL:  g.baseURL,
		APIKey:   g.apiKey,
	}, openaicompat.Prompt{Feature: feature, Model: model, Temperature: temperature, System: systemPrompt, User: userContent})
}

// chatWith binds chat to one model, giving the feature packages the
// llm.Chat they call.
func (g *Gemini) chatWith(model string) llm.Chat {
	return func(ctx context.Context, feature string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
		return g.chat(ctx, feature, model, temperature, systemPrompt, userContent)
	}
}
