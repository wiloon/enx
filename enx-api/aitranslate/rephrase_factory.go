package aitranslate

import (
	"context"
	"enx-api/config"
	"fmt"
)

// NewRephraser builds the configured sentence-translate.provider for rephrase
// (ADR-012 Decision 1): New, then require that the provider serves it.
//
// Same "unconfigured is not fatal" contract as New: if the provider is
// unset, the caller logs and disables the feature; if the provider IS set
// but can't be built or doesn't support rephrase, that's a
// misconfiguration and the caller should fail fast.
func NewRephraser(ctx context.Context, cfg config.SentenceTranslate) (*Provider, error) {
	p, err := New(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if p.RephraseChat == nil {
		return nil, fmt.Errorf("aitranslate: provider %q does not support rephrase", cfg.Provider)
	}
	return p, nil
}
