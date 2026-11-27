package aitranslate

import (
	"context"
	"net/http"
	"testing"
)

func TestNewRephraserUnconfiguredProvider(t *testing.T) {
	if _, err := NewRephraser(context.Background(), provider("")); err == nil {
		t.Fatal("expected an error when sentence-translate.provider is unset")
	}
}

func TestNewRephraserKimiMissingAPIKey(t *testing.T) {
	if _, err := NewRephraser(context.Background(), provider("kimi")); err == nil {
		t.Fatal("expected an error when KIMI_API_KEY is not set")
	}
}

func TestRephraseHandlerWithoutARephraseChatIsNotConfigured(t *testing.T) {
	h := NewRephraseHandler(&Provider{}, &fakeRephraseLedger{balance: 100}, testPricing)

	w := doRephrase(t, h, `{"input":"hi"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", w.Code, w.Body)
	}
}
