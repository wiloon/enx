package kimi

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTranslateSentenceWithWordSuccess(t *testing.T) {
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"sentence\":\"我在银行存了现金。\",\"word\":\"银行\"}"}}],"usage":{"prompt_tokens":120,"completion_tokens":40,"total_tokens":160}}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	res, u, err := k.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "银行" {
		t.Fatalf("result: got %+v", res)
	}
	if u.PromptTokens != 120 || u.CompletionTokens != 40 {
		t.Fatalf("usage: got %+v", u)
	}
	if !bytes.Contains(capturedBody, []byte("bank")) || !bytes.Contains(capturedBody, []byte("deposited cash")) {
		t.Fatalf("request body missing sentence/word: %s", capturedBody)
	}
}

// A model that returns the sentence but omits the word gloss degrades
// gracefully: no error, empty WordChinese (ADR-014).
func TestTranslateSentenceWithWordMissingWordGloss(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"sentence\":\"我在银行存了现金。\"}"}}]}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	res, _, err := k.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "" {
		t.Fatalf("result: got %+v", res)
	}
}

func TestTranslateSentenceWithWordNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	if _, _, err := k.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank"); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTranslateSentenceWithWordUnparseable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"sorry, I can't"}}]}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	if _, _, err := k.TranslateSentenceWithWord(context.Background(), "s", "w"); err == nil {
		t.Fatal("expected a parse error to propagate, got nil")
	}
}
