package kimi

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRephraseSuccess(t *testing.T) {
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"idiomatic\":\"Could you review this PR when you have a moment?\",\"alternatives\":[{\"text\":\"Mind reviewing this PR?\",\"register\":\"casual (Slack)\"}],\"notes\":[\"用 when you have a moment 弱化催促感。\"]}"}}],"usage":{"prompt_tokens":120,"completion_tokens":80,"total_tokens":200}}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	got, err := k.Rephrase(context.Background(), "帮我看下这个 PR")
	if err != nil {
		t.Fatalf("Rephrase: %v", err)
	}
	if got.Idiomatic != "Could you review this PR when you have a moment?" {
		t.Fatalf("Idiomatic: got %q", got.Idiomatic)
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].Register != "casual (Slack)" {
		t.Fatalf("Alternatives: got %+v", got.Alternatives)
	}
	if got.Usage.PromptTokens != 120 || got.Usage.CompletionTokens != 80 || got.Usage.TotalTokens != 200 {
		t.Fatalf("Usage: got %+v", got.Usage)
	}
	if !bytes.Contains(capturedBody, []byte("帮我看下这个 PR")) {
		t.Fatalf("request body missing the user input: %s", capturedBody)
	}
}

func TestRephraseNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	if _, err := k.Rephrase(context.Background(), "帮我看下这个 PR"); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestRephrasePropagatesParseFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"I can't do that."}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
	}))
	defer srv.Close()

	k := newTestKimi(srv.URL)
	if _, err := k.Rephrase(context.Background(), "帮我看下这个 PR"); err == nil {
		t.Fatal("expected a parse error to propagate, got nil")
	}
}
