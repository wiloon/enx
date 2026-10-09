package aitranslate

import (
	"context"
	"enx-api/config"
	"fmt"

	"enx-api/aitranslate/rephrase"
)

// NewRephraser builds the rephrase.Rephraser for the configured
// sentence-translate.provider (ADR-012 Decision 1). It reuses New to
// construct the provider client, then requires that client to also
// implement rephrase.Rephraser.
//
// Same "unconfigured is not fatal" contract as New: if the provider is
// unset, the caller logs and disables the feature; if the provider IS set
// but can't be built or doesn't support rephrase, that's a
// misconfiguration and the caller should fail fast.
func NewRephraser(ctx context.Context, cfg config.SentenceTranslate) (rephrase.Rephraser, error) {
	translator, err := New(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return asRephraser(translator, cfg.Provider)
}

func asRephraser(t Translator, provider string) (rephrase.Rephraser, error) {
	r, ok := t.(rephrase.Rephraser)
	if !ok {
		return nil, fmt.Errorf("aitranslate: provider %q does not support rephrase", provider)
	}
	return r, nil
}
