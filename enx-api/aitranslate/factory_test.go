package aitranslate

import (
	"context"
	"testing"

	"github.com/spf13/viper"
)

func withProvider(t *testing.T, provider string) {
	t.Helper()
	viper.Set("sentence-translate.provider", provider)
	t.Cleanup(func() {
		viper.Set("sentence-translate.provider", "")
	})
}

func TestNewUnconfiguredProvider(t *testing.T) {
	withProvider(t, "")
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error when sentence-translate.provider is unset")
	}
}

func TestNewUnknownProvider(t *testing.T) {
	withProvider(t, "does-not-exist")
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestNewKimiMissingAPIKey(t *testing.T) {
	withProvider(t, "kimi")
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error when KIMI_API_KEY is not set")
	}
}

func TestNewMiniMaxMissingAPIKey(t *testing.T) {
	withProvider(t, "minimax")
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error when MINIMAX_API_KEY is not set")
	}
}

func TestNewBedrockMissingModelID(t *testing.T) {
	withProvider(t, "bedrock")
	if _, err := New(context.Background()); err == nil {
		t.Fatal("expected error when sentence-translate.bedrock.model-id is not set")
	}
}
