package kimi

import (
	"context"
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
	chinese, err := k.TranslateSentence(context.Background(), "Hello world")
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
	_, err := k.TranslateSentence(context.Background(), "Hello world")
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

	_, err := k.TranslateSentence(context.Background(), "Hello world")
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

func TestNewRequiresAPIKey(t *testing.T) {
	if _, err := New(); err == nil {
		t.Fatal("expected error when KIMI_API_KEY is not set")
	}
}
