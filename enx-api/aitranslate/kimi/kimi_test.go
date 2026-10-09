package kimi

import (
	"bytes"
	"context"
	"enx-api/config"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-resty/resty/v2"
)

func newTestKimi(baseURL string) *Kimi {
	return &Kimi{
		apiKey:  "test-key",
		model:   defaultModel,
		baseURL: baseURL,
		client:  resty.New().SetTimeout(5 * time.Second),
	}
}

func TestTranslateSentenceSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"你好世界"}}]}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	chinese, _, err := k.TranslateSentence(context.Background(), "Hello world")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if chinese != "你好世界" {
		t.Fatalf("chinese: got %q", chinese)
	}
}

func TestTranslateSentenceNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	_, _, err := k.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTranslateSentenceTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"too late"}}]}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	k.client.SetTimeout(10 * time.Millisecond)

	_, _, err := k.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

func TestTranslateWordInContextSuccess(t *testing.T) {
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"word\":\"银行\",\"why\":\"\"}"}}]}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	res, _, err := k.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank", "n. 银行；水岸")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "银行" {
		t.Fatalf("result: got %+v", res)
	}
	if !bytes.Contains(capturedBody, []byte("bank")) || !bytes.Contains(capturedBody, []byte("deposited cash")) || !bytes.Contains(capturedBody, []byte("Dictionary definition")) {
		t.Fatalf("request body missing sentence/word/dictionary context: %s", capturedBody)
	}
}

// ADR-008: word-in-context is reused as-is for a multi-word phrase (no
// dictionary entry exists for a phrase, so this is the only lookup path).
func TestTranslateWordInContextPhrase(t *testing.T) {
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"word\":\"找到邮箱地址并联系\",\"why\":\"\"}"}}]}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	res, _, err := k.TranslateWordInContext(
		context.Background(),
		"I'd have to find the right contacts, hunt down emails, and draft outreach.",
		"hunt down emails",
		"",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.WordChinese != "找到邮箱地址并联系" {
		t.Fatalf("result: got %+v", res)
	}
	if !bytes.Contains(capturedBody, []byte("hunt down emails")) {
		t.Fatalf("request body missing phrase: %s", capturedBody)
	}
	if bytes.Contains(capturedBody, []byte("Dictionary definition")) {
		t.Fatalf("request body should omit dictionary definition line when empty: %s", capturedBody)
	}
}

func TestTranslateWordInContextNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	_, _, err := k.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank", "")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestNewRequiresAPIKey(t *testing.T) {
	if _, err := New(config.OpenAICompatible{}, time.Second); err == nil {
		t.Fatal("expected error when KIMI_API_KEY is not set")
	}
}

func TestNewTakesItsSettingsFromConfig(t *testing.T) {
	got, err := New(config.OpenAICompatible{APIKey: "key", BaseURL: "https://example.test/v1", Model: "m1"}, 7*time.Second)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got.apiKey != "key" || got.baseURL != "https://example.test/v1" || got.model != "m1" {
		t.Errorf("New() = %+v, want the configured key, base URL and model", got)
	}
	if timeout := got.client.GetClient().Timeout; timeout != 7*time.Second {
		t.Errorf("client timeout = %v, want 7s", timeout)
	}
}

func TestNewFallsBackToDefaultModelAndBaseURL(t *testing.T) {
	got, err := New(config.OpenAICompatible{APIKey: "key"}, time.Second)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got.model != defaultModel || got.baseURL != defaultBaseURL {
		t.Errorf("model, baseURL = %q, %q; want %q, %q", got.model, got.baseURL, defaultModel, defaultBaseURL)
	}
}
