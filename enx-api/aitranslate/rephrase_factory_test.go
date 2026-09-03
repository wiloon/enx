package aitranslate

import (
	"context"
	"testing"

	"enx-api/aitranslate/rephrase"
)

// translatorOnly implements Translator but NOT rephrase.Rephraser -- stands
// in for a provider (minimax, bedrock) that hasn't added rephrase support.
type translatorOnly struct{}

func (translatorOnly) TranslateSentence(ctx context.Context, s string) (string, error) {
	return "", nil
}
func (translatorOnly) TranslateWordInContext(ctx context.Context, s, w string) (string, error) {
	return "", nil
}

// translatorAndRephraser is a provider that supports both.
type translatorAndRephraser struct{ translatorOnly }

func (translatorAndRephraser) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	return rephrase.Result{}, nil
}

func TestAsRephraserRejectsProviderWithoutSupport(t *testing.T) {
	if _, err := asRephraser(translatorOnly{}, "minimax"); err == nil {
		t.Fatal("expected an error when the provider does not implement Rephraser")
	}
}

func TestAsRephraserAcceptsProviderWithSupport(t *testing.T) {
	got, err := asRephraser(translatorAndRephraser{}, "kimi")
	if err != nil {
		t.Fatalf("asRephraser: %v", err)
	}
	if got == nil {
		t.Fatal("got nil Rephraser")
	}
}

func TestNewRephraserUnconfiguredProvider(t *testing.T) {
	withProvider(t, "")
	if _, err := NewRephraser(context.Background()); err == nil {
		t.Fatal("expected an error when sentence-translate.provider is unset")
	}
}

func TestNewRephraserKimiMissingAPIKey(t *testing.T) {
	withProvider(t, "kimi")
	if _, err := NewRephraser(context.Background()); err == nil {
		t.Fatal("expected an error when KIMI_API_KEY is not set")
	}
}
