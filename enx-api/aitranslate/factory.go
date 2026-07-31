package aitranslate

import (
	"context"
	"fmt"

	"enx-api/aitranslate/bedrock"
	"enx-api/aitranslate/kimi"
	"enx-api/aitranslate/minimax"

	"github.com/spf13/viper"
)

// New builds the Translator selected by sentence-translate.provider in
// config.toml ("kimi", "bedrock", or "minimax").
//
// If the provider is unset entirely, sentence translation is treated as an
// optional, unconfigured feature (like ECDICT when ecdict.db_path is empty)
// and New returns an error the caller can log and degrade from gracefully.
// If the provider IS set but its required config/credentials are missing,
// that's a deliberate misconfiguration and callers should fail fast (see
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §4.4).
func New(ctx context.Context) (Translator, error) {
	provider := viper.GetString("sentence-translate.provider")
	switch provider {
	case "kimi":
		return kimi.New()
	case "bedrock":
		return bedrock.New(ctx)
	case "minimax":
		return minimax.New()
	case "":
		return nil, fmt.Errorf("aitranslate: sentence-translate.provider is not configured")
	default:
		return nil, fmt.Errorf("aitranslate: unknown sentence-translate.provider %q (must be \"kimi\", \"bedrock\", or \"minimax\")", provider)
	}
}
