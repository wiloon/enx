// Package minimax implements aitranslate.Translator against MiniMax's
// OpenAI-compatible Chat Completions API (https://api.minimax.io/v1/chat/completions).
// MiniMax's older ChatCompletion Pro API required a group_id query parameter;
// the current OpenAI-compatible endpoint does not, so GroupID below is kept
// optional for forward/backward compatibility rather than required.
package minimax

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
	defaultModel   = "MiniMax-Text-01"
	defaultBaseURL = "https://api.minimax.io/v1"

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
		client:  resty.New().SetTimeout(aicfg.RequestTimeout()),
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

// usage mirrors the OpenAI-compatible "usage" object MiniMax's Chat
// Completions API returns alongside every response. Rephrase bills by these
// real token counts (ADR-012 Decision 5); translation still only logs them,
// pending its own token-billing decision.
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

func (m *MiniMax) TranslateSentence(ctx context.Context, sentence string) (string, aiusage.Usage, error) {
	out, u, err := m.chat(ctx, "translate_sentence", 0.3, systemPrompt, sentence)
	return out, toUsage(u), err
}

func (m *MiniMax) TranslateWordInContext(ctx context.Context, sentence, word string) (string, aiusage.Usage, error) {
	out, u, err := m.chat(ctx, "translate_word_in_context", 0.3, wordContextSystemPrompt, fmt.Sprintf("Sentence: %s\nWord: %s", sentence, word))
	return out, toUsage(u), err
}

// toUsage maps MiniMax's OpenAI-compatible usage object to the
// provider-neutral aiusage.Usage the Translator interface returns.
func toUsage(u usage) aiusage.Usage {
	return aiusage.Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
}

func (m *MiniMax) chat(ctx context.Context, feature string, temperature float64, systemPrompt, userContent string) (string, usage, error) {
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
			Temperature: temperature,
		}).
		SetResult(&result).
		Post(m.baseURL + "/chat/completions")

	if err != nil {
		return "", usage{}, fmt.Errorf("minimax: request failed: %w", err)
	}
	if resp.StatusCode() != 200 {
		return "", usage{}, fmt.Errorf("minimax: unexpected status %d: %s", resp.StatusCode(), resp.String())
	}
	if len(result.Choices) == 0 {
		return "", usage{}, fmt.Errorf("minimax: empty response")
	}

	logger.Infof("aitranslate: usage provider=minimax feature=%s model=%s input_chars=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d",
		feature, m.model, len(userContent), result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens)

	raw := result.Choices[0].Message.Content
	content := stripReasoning(raw)
	if content != raw {
		logger.Debugf("aitranslate: minimax feature=%s stripped %d chars of <think> reasoning", feature, len(raw)-len(content))
	}
	return content, result.Usage, nil
}

// stripReasoning removes the chain-of-thought MiniMax's M-series ("thinking")
// models emit inline in the message content, wrapped in <think>...</think>
// (the opening tag is sometimes implied and only the closing one is sent).
// The model drafts its answer -- sometimes a whole JSON object -- inside that
// block before the real answer, which breaks callers that scan the content
// for the first '{' (rephrase.ParseResult) or treat the whole string as the
// result (sentence translation). Everything up to and including the final
// </think> is reasoning; keep only what follows. A <think> with no close
// means the reply was truncated mid-thought and carries no usable answer.
func stripReasoning(content string) string {
	const openTag, closeTag = "<think>", "</think>"
	if i := strings.LastIndex(content, closeTag); i >= 0 {
		return strings.TrimSpace(content[i+len(closeTag):])
	}
	if strings.Contains(content, openTag) {
		return ""
	}
	return content
}
