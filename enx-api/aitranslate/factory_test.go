package aitranslate

import (
	"context"
	"strings"
	"testing"
	"time"

	"enx-api/aitranslate/deepseek"
	"enx-api/config"
	"enx-api/utils/logger"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
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

// observeLogs captures everything logged for the rest of the test.
func observeLogs(t *testing.T) *observer.ObservedLogs {
	t.Helper()
	core, logs := observer.New(zap.DebugLevel)
	t.Cleanup(logger.Swap(zap.New(core).Sugar()))
	return logs
}

func TestNewMiniMaxWarnsItIsDeprecatedEvenWhenConstructionFails(t *testing.T) {
	logs := observeLogs(t)

	if _, err := New(context.Background(), provider("minimax")); err == nil {
		t.Fatal("expected error when MINIMAX_API_KEY is not set")
	}

	warns := logs.FilterLevelExact(zapcore.WarnLevel).All()
	if len(warns) != 1 {
		t.Fatalf("got %d Warn entries, want 1: %v", len(warns), warns)
	}
	for _, want := range []string{"deprecated", "#1152"} {
		if !strings.Contains(warns[0].Message, want) {
			t.Errorf("Warn message %q does not contain %q", warns[0].Message, want)
		}
	}
}

func TestNewDeepSeekDoesNotWarn(t *testing.T) {
	logs := observeLogs(t)
	cfg := provider("deepseek")
	cfg.DeepSeek.APIKey = "test-key"

	if _, err := New(context.Background(), cfg); err != nil {
		t.Fatalf("New: %v", err)
	}

	if warns := logs.FilterLevelExact(zapcore.WarnLevel).All(); len(warns) != 0 {
		t.Fatalf("got Warn entries, want none: %v", warns)
	}
}
