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
)

// New builds the Translator selected by cfg.Provider (sentence-translate.provider) ("kimi", "bedrock", "minimax", "deepseek", "gemini", or
// "openrouter").
//
// If the provider is unset entirely, sentence translation is treated as an
// optional, unconfigured feature (like ECDICT when ecdict.db_path is empty)
// and New returns an error the caller can log and degrade from gracefully.
// If the provider IS set but its required config/credentials are missing,
// that's a deliberate misconfiguration and callers should fail fast (see
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §4.4).
func New(ctx context.Context, cfg config.SentenceTranslate) (Translator, error) {
	provider := cfg.Provider
	switch provider {
	case "kimi":
		return kimi.New(cfg.Kimi, cfg.RequestTimeout)
	case "bedrock":
		return bedrock.New(ctx, cfg.Bedrock, cfg.RequestTimeout)
	case "minimax":
		return minimax.New(cfg.MiniMax, cfg.RequestTimeout)
	case "deepseek":
		return deepseek.New(cfg.DeepSeek, cfg.RequestTimeout)
	case "gemini":
		return gemini.New(cfg.Gemini, cfg.RequestTimeout)
	case "openrouter":
		return openrouter.New(cfg.OpenRouter, cfg.RequestTimeout)
	case "":
		return nil, fmt.Errorf("aitranslate: sentence-translate.provider is not configured")
	default:
		return nil, fmt.Errorf("aitranslate: unknown sentence-translate.provider %q (must be \"kimi\", \"bedrock\", \"minimax\", \"deepseek\", \"gemini\", or \"openrouter\")", provider)
	}
}
