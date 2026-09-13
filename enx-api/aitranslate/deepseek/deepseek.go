// Package deepseek implements aitranslate.Translator against DeepSeek's
// OpenAI-compatible Chat Completions API (https://api.deepseek.com). There is
// no separate "international" vs "China" DeepSeek account/endpoint (unlike
// MiniMax, see minimax.go) -- one api-key, one base URL, used globally.
package deepseek

import (
	"context"
	"fmt"

	"enx-api/aitranslate/aicfg"
	"enx-api/aitranslate/aiusage"
	"enx-api/utils/logger"

	"github.com/go-resty/resty/v2"
	"github.com/spf13/viper"
)

const (
	// deepseek-chat is DeepSeek-V3, a non-reasoning model -- no <think>
	// block to strip from translation output, unlike a "thinking" model
	// (e.g. deepseek-reasoner, or MiniMax's M-series) would produce.
	defaultModel   = "deepseek-chat"
	defaultBaseURL = "https://api.deepseek.com"

	systemPrompt = "You are a professional English-to-Chinese translator. " +
		"Translate the given English sentence into natural, fluent Chinese. " +
		"Reply with the Chinese translation only, no explanation, no pinyin, no quotes."

	wordContextSystemPrompt = "You are a professional English-to-Chinese translator. " +
		"Given an English sentence and a specific word or phrase from that sentence, reply with " +
		"its Chinese meaning as used in THIS sentence's context only, not a generic " +
		"dictionary definition. Reply with the Chinese meaning only, no explanation, no pinyin, no quotes."
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
func New() (*DeepSeek, error) {
	apiKey := viper.GetString("sentence-translate.deepseek.api-key")
	if apiKey == "" {
		return nil, fmt.Errorf("deepseek: DEEPSEEK_API_KEY is not set")
	}

	model := viper.GetString("sentence-translate.deepseek.model")
	if model == "" {
		model = defaultModel
	}
	baseURL := viper.GetString("sentence-translate.deepseek.base-url")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &DeepSeek{
		apiKey:        apiKey,
		model:         model,
		rephraseModel: viper.GetString("sentence-translate.deepseek.rephrase-model"),
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

// usage mirrors the OpenAI-compatible "usage" object DeepSeek's Chat
// Completions API returns alongside every response.
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

func (d *DeepSeek) TranslateSentence(ctx context.Context, sentence string) (string, aiusage.Usage, error) {
	out, u, err := d.chat(ctx, "translate_sentence", d.model, 0.3, systemPrompt, sentence)
	return out, toUsage(u), err
}

func (d *DeepSeek) TranslateWordInContext(ctx context.Context, sentence, word string) (string, aiusage.Usage, error) {
	out, u, err := d.chat(ctx, "translate_word_in_context", d.model, 0.3, wordContextSystemPrompt, fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word))
	return out, toUsage(u), err
}

// toUsage maps DeepSeek's OpenAI-compatible usage object to the
// provider-neutral aiusage.Usage the Translator interface returns.
func toUsage(u usage) aiusage.Usage {
	return aiusage.Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
}

func (d *DeepSeek) chat(ctx context.Context, feature, model string, temperature float64, systemPrompt, userContent string) (string, usage, error) {
	var result chatResponse
	resp, err := d.client.R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+d.apiKey).
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
		Post(d.baseURL + "/chat/completions")

	if err != nil {
		return "", usage{}, fmt.Errorf("deepseek: request failed: %w", err)
	}
	if resp.StatusCode() != 200 {
		return "", usage{}, fmt.Errorf("deepseek: unexpected status %d: %s", resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", usage{}, fmt.Errorf("deepseek: empty response")
	}

	logger.Infof("aitranslate: usage provider=deepseek feature=%s model=%s input_chars=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d",
		feature, model, len(userContent), result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens)

	return result.Choices[0].Message.Content, result.Usage, nil
}
