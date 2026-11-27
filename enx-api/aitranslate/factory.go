package aitranslate

import (
	"context"
	"enx-api/config"
	"fmt"

	"enx-api/aitranslate/bedrock"
	"enx-api/aitranslate/deepseek"
	"enx-api/aitranslate/gemini"
	"enx-api/aitranslate/kimi"
	"enx-api/aitranslate/minimax"
	"enx-api/aitranslate/openrouter"
	"enx-api/utils/logger"
)

// New builds the Provider selected by cfg.Provider (sentence-translate.provider)
// ("kimi", "bedrock", "minimax", "deepseek", "gemini", or "openrouter").
//
// If the provider is unset entirely, sentence translation is treated as an
// optional, unconfigured feature (like ECDICT when ecdict.db_path is empty)
// and New returns an error the caller can log and degrade from gracefully.
// If the provider IS set but its required config/credentials are missing,
// that's a deliberate misconfiguration and callers should fail fast (see
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §4.4).
func New(ctx context.Context, cfg config.SentenceTranslate) (*Provider, error) {
	provider := cfg.Provider
	switch provider {
	case "kimi":
		k, err := kimi.New(cfg.Kimi, cfg.RequestTimeout)
		if err != nil {
			return nil, err
		}
		return &Provider{Chat: k.Chat, RephraseChat: k.RephraseChat, ParseAttempts: 1}, nil
	case "bedrock":
		b, err := bedrock.New(ctx, cfg.Bedrock, cfg.RequestTimeout)
		if err != nil {
			return nil, err
		}
		return &Provider{Chat: b.Chat, ParseAttempts: 1}, nil
	case "minimax":
		// Before minimax.New, so a failed construction warns too.
		logger.Warnf("⚠️  aitranslate: sentence-translate.provider \"minimax\" is deprecated (#1152)")
		m, err := minimax.New(cfg.MiniMax, cfg.RequestTimeout)
		if err != nil {
			return nil, err
		}
		return &Provider{Chat: m.Chat, RephraseChat: m.Chat, ParseAttempts: 2}, nil
	case "deepseek":
		d, err := deepseek.New(cfg.DeepSeek, cfg.RequestTimeout)
		if err != nil {
			return nil, err
		}
		return &Provider{Chat: d.Chat, RephraseChat: d.RephraseChat, DefinesWords: true, ParseAttempts: 1}, nil
	case "gemini":
		g, err := gemini.New(cfg.Gemini, cfg.RequestTimeout)
		if err != nil {
			return nil, err
		}
		return &Provider{Chat: g.Chat, RephraseChat: g.RephraseChat, ParseAttempts: 1}, nil
	case "openrouter":
		o, err := openrouter.New(cfg.OpenRouter, cfg.RequestTimeout)
		if err != nil {
			return nil, err
		}
		return &Provider{Chat: o.Chat, RephraseChat: o.RephraseChat, DefinesWords: true, ParseAttempts: 1}, nil
	case "":
		return nil, fmt.Errorf("aitranslate: sentence-translate.provider is not configured")
	default:
		return nil, fmt.Errorf("aitranslate: unknown sentence-translate.provider %q (must be \"kimi\", \"bedrock\", \"minimax\", \"deepseek\", \"gemini\", or \"openrouter\")", provider)
	}
}
