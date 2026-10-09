package aitranslate

import (
	"context"
	"testing"
	"time"

	"enx-api/aitranslate/deepseek"
	"enx-api/config"
)

// provider is a sentence-translate config selecting name, with no provider
// credentials set.
func provider(name string) config.SentenceTranslate {
	return config.SentenceTranslate{Provider: name, RequestTimeout: time.Second}
}

func TestNewUnconfiguredProvider(t *testing.T) {
	if _, err := New(context.Background(), provider("")); err == nil {
		t.Fatal("expected error when sentence-translate.provider is unset")
	}
}

func TestNewUnknownProvider(t *testing.T) {
	if _, err := New(context.Background(), provider("does-not-exist")); err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestNewKimiMissingAPIKey(t *testing.T) {
	if _, err := New(context.Background(), provider("kimi")); err == nil {
		t.Fatal("expected error when KIMI_API_KEY is not set")
	}
}

func TestNewMiniMaxMissingAPIKey(t *testing.T) {
	if _, err := New(context.Background(), provider("minimax")); err == nil {
		t.Fatal("expected error when MINIMAX_API_KEY is not set")
	}
}

func TestNewBedrockMissingModelID(t *testing.T) {
	if _, err := New(context.Background(), provider("bedrock")); err == nil {
		t.Fatal("expected error when sentence-translate.bedrock.model-id is not set")
	}
}

func TestNewDeepSeekMissingAPIKey(t *testing.T) {
	if _, err := New(context.Background(), provider("deepseek")); err == nil {
		t.Fatal("expected error when DEEPSEEK_API_KEY is not set")
	}
}

func TestNewGeminiMissingAPIKey(t *testing.T) {
	if _, err := New(context.Background(), provider("gemini")); err == nil {
		t.Fatal("expected error when GEMINI_API_KEY is not set")
	}
}

func TestNewOpenRouterMissingAPIKey(t *testing.T) {
	if _, err := New(context.Background(), provider("openrouter")); err == nil {
		t.Fatal("expected error when OPENROUTER_API_KEY is not set")
	}
}

func TestNewBuildsTheSelectedProviderFromItsConfig(t *testing.T) {
	cfg := provider("deepseek")
	cfg.DeepSeek.APIKey = "test-key"
	got, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := got.(*deepseek.DeepSeek); !ok {
		t.Fatalf("New() = %T, want *deepseek.DeepSeek", got)
	}
}
