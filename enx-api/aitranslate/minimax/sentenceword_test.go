package minimax

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

	m := newTestMiniMax(srv.URL)
	res, u, err := m.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank")
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

func TestTranslateSentenceWithWordMissingWordGloss(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"sentence\":\"我在银行存了现金。\"}"}}]}`))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	res, _, err := m.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.SentenceChinese != "我在银行存了现金。" || res.WordChinese != "" {
		t.Fatalf("result: got %+v", res)
	}
}

// Reproduces the homelab 2026-09-13 incident end to end: MiniMax's first
// reply has no recoverable JSON at all (e.g. it answered in prose instead),
// the second is clean -- the retry should recover instead of surfacing
// "translation service unavailable", and usage should sum both attempts
// since both really consumed tokens.
func TestTranslateSentenceWithWordRetriesOnMalformedReply(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if calls == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Sorry, I cannot help with that."}}],"usage":{"prompt_tokens":100,"completion_tokens":30,"total_tokens":130}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"sentence\":\"我们的越狱者是自主的\",\"word\":\"自主的\"}"}}],"usage":{"prompt_tokens":110,"completion_tokens":25,"total_tokens":135}}`))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	res, u, err := m.TranslateSentenceWithWord(context.Background(), "Our jailbreakers are autonomous.", "autonomous")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 attempts, got %d", calls)
	}
	if res.SentenceChinese != "我们的越狱者是自主的" || res.WordChinese != "自主的" {
		t.Fatalf("result: got %+v", res)
	}
	if u.PromptTokens != 210 || u.CompletionTokens != 55 || u.TotalTokens != 265 {
		t.Fatalf("usage should sum both attempts: got %+v", u)
	}
}

func TestTranslateSentenceWithWordGivesUpAfterMaxAttempts(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"not json at all"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	if _, _, err := m.TranslateSentenceWithWord(context.Background(), "irrelevant", "irrelevant"); err == nil {
		t.Fatal("expected an error once every attempt fails to parse")
	}
	if calls != sentenceWithWordMaxAttempts {
		t.Fatalf("expected exactly %d attempts, got %d", sentenceWithWordMaxAttempts, calls)
	}
}

func TestTranslateSentenceWithWordNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	if _, _, err := m.TranslateSentenceWithWord(context.Background(), "I deposited cash at the bank.", "bank"); err == nil {
		t.Fatal("expected error, got nil")
	}
}
