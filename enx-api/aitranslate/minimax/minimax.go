// Package minimax offers the AI provider's chats on MiniMax's
// OpenAI-compatible Chat Completions API (https://api.minimax.io/v1/chat/completions).
// MiniMax's older ChatCompletion Pro API required a group_id query parameter;
// the current OpenAI-compatible endpoint does not, so GroupID below is kept
// optional for forward/backward compatibility rather than required.
//
// Deprecated: MiniMax is not used in production or in the China edition
// launch. The code is kept until after launch, when its future is decided
// (ADR-035, #1152). Do not extend it, and do not add MiniMax-specific tests or
// behaviour in other work.
package minimax

import (
	"context"
	"enx-api/config"
	"fmt"
	"strings"
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/openaicompat"
	"enx-api/utils/logger"

	"github.com/go-resty/resty/v2"
)

const (
	defaultModel   = "MiniMax-Text-01"
	defaultBaseURL = "https://api.minimax.io/v1"
)

// MiniMax is the MiniMax provider client.
//
// Deprecated: MiniMax is not used in production or in the China edition
// launch. The code is kept until after launch, when its future is decided
// (ADR-035, #1152). Do not extend it, and do not add MiniMax-specific tests or
// behaviour in other work.
type MiniMax struct {
	apiKey  string
	model   string
	baseURL string
	groupID string
	client  *resty.Client
}

// New builds a MiniMax client from config.toml (sentence-translate.minimax.*)
// and the MINIMAX_API_KEY environment variable. It returns an error
// immediately if the API key is missing, so a "provider = minimax"
// misconfiguration is caught at startup rather than on the first request.
//
// Deprecated: MiniMax is not used in production or in the China edition
// launch. The code is kept until after launch, when its future is decided
// (ADR-035, #1152). Do not extend it, and do not add MiniMax-specific tests or
// behaviour in other work.
func New(c config.MiniMax, timeout time.Duration) (*MiniMax, error) {
	apiKey := c.APIKey.Reveal()
	if apiKey == "" {
		return nil, fmt.Errorf("minimax: MINIMAX_API_KEY is not set")
	}

	model := c.Model
	if model == "" {
		model = defaultModel
	}
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &MiniMax{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		groupID: c.GroupID,
		client:  resty.New().SetTimeout(timeout),
	}, nil
}

// Chat is the llm.Chat for every feature, rephrase included: MiniMax has no
// rephrase model of its own.
func (m *MiniMax) Chat(ctx context.Context, feature string, temperature float64, systemPrompt, userContent string) (string, aiusage.Usage, error) {
	e := openaicompat.Endpoint{Provider: "minimax", BaseURL: m.baseURL, APIKey: m.apiKey}
	if m.groupID != "" {
		e.Query = map[string]string{"GroupId": m.groupID}
	}
	raw, u, err := openaicompat.Chat(ctx, m.client, e, openaicompat.Prompt{
		Feature: feature, Model: m.model, Temperature: temperature, System: systemPrompt, User: userContent,
	})
	if err != nil {
		return "", u, err
	}

	content := stripReasoning(raw)
	if content != raw {
		logger.Debugf("aitranslate: minimax feature=%s stripped %d chars of <think> reasoning", feature, len(raw)-len(content))
	}
	return content, u, nil
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
