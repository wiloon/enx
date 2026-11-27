package aitranslate

import (
	"context"
	"testing"
	"time"

	"enx-api/config"
)

// The constructors the wired tests (wired_test.go) go through, as
// server/router.go wires them: config, New, Instrument, handler.

func wiredConfig(provider, baseURL, rephraseModel string) config.SentenceTranslate {
	compatible := config.OpenAICompatible{APIKey: "test-key", BaseURL: baseURL, Model: "test-model", RephraseModel: rephraseModel}
	return config.SentenceTranslate{
		Provider:       provider,
		RequestTimeout: 5 * time.Second,
		DeepSeek:       compatible,
		Gemini:         compatible,
		Kimi:           compatible,
		OpenRouter:     compatible,
		MiniMax:        config.MiniMax{APIKey: "test-key", BaseURL: baseURL, Model: "test-model"},
		Bedrock:        config.Bedrock{Region: "us-east-1", ModelID: "model-x"},
	}
}

func wiredHandler(t *testing.T, cfg config.SentenceTranslate, ledger TokenLedger, obs AIObserver) *Handler {
	t.Helper()
	p, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return NewHandler(Instrument(p, cfg.Provider, obs), ledger, tokenTestPricing)
}

func wiredRephraseHandler(t *testing.T, cfg config.SentenceTranslate, ledger TokenLedger, obs AIObserver) *RephraseHandler {
	t.Helper()
	r, err := NewRephraser(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewRephraser: %v", err)
	}
	return NewRephraseHandler(InstrumentRephraser(r, cfg.Provider, obs), ledger, tokenTestPricing)
}

func wiredDefiner(t *testing.T, cfg config.SentenceTranslate, obs AIObserver) (WordDefiner, bool) {
	t.Helper()
	p, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return AsWordDefiner(Instrument(p, cfg.Provider, obs))
}
