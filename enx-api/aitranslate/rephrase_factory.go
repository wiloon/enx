package aitranslate

import (
	"context"
	"fmt"

	"enx-api/aitranslate/rephrase"

	"github.com/spf13/viper"
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
func NewRephraser(ctx context.Context) (rephrase.Rephraser, error) {
	translator, err := New(ctx)
	if err != nil {
		return nil, err
	}
	return asRephraser(translator, viper.GetString("sentence-translate.provider"))
}

func asRephraser(t Translator, provider string) (rephrase.Rephraser, error) {
	r, ok := t.(rephrase.Rephraser)
	if !ok {
		return nil, fmt.Errorf("aitranslate: provider %q does not support rephrase", provider)
	}
	return r, nil
}
