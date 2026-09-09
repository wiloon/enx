package minimax

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
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"idiomatic\":\"Could you review this PR when you have a moment?\",\"alternatives\":[{\"text\":\"Mind reviewing this PR?\",\"register\":\"casual (Slack)\"}],\"notes\":[\"用 when you have a moment 弱化催促感。\"]}"}}],"usage":{"prompt_tokens":130,"completion_tokens":70,"total_tokens":200}}`))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	got, err := m.Rephrase(context.Background(), "帮我看下这个 PR")
	if err != nil {
		t.Fatalf("Rephrase: %v", err)
	}
	if got.Idiomatic != "Could you review this PR when you have a moment?" {
		t.Fatalf("Idiomatic: got %q", got.Idiomatic)
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].Register != "casual (Slack)" {
		t.Fatalf("Alternatives: got %+v", got.Alternatives)
	}
	if got.Usage.PromptTokens != 130 || got.Usage.CompletionTokens != 70 || got.Usage.TotalTokens != 200 {
		t.Fatalf("Usage: got %+v", got.Usage)
	}
	if !bytes.Contains(capturedBody, []byte("帮我看下这个 PR")) {
		t.Fatalf("request body missing the user input: %s", capturedBody)
	}
}

// MiniMax's M-series ("thinking") models return their chain of thought
// inline in message.content wrapped in <think>...</think>, and draft a JSON
// object inside it before the real answer. Without stripping, ParseResult
// grabs the first '{' from the draft and 502s with
// "invalid character '<' after top-level value" (the '<' of </think>).
func TestRephraseStripsThinkReasoning(t *testing.T) {
	body := `{"choices":[{"message":{"role":"assistant","content":"<think>\nThey want a colleague to take a look. Draft: {\"idiomatic\":\"rough\"}\nRefine the wording.\n</think>\n\n{\"idiomatic\":\"Could you take a look at this when you get a chance?\",\"alternatives\":[{\"text\":\"Mind taking a look at this?\",\"register\":\"casual (Slack)\"}],\"notes\":[\"用 when you get a chance 弱化催促。\"]}"}}],"usage":{"prompt_tokens":269,"completion_tokens":419,"total_tokens":688}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	got, err := m.Rephrase(context.Background(), "帮我看下这个问题")
	if err != nil {
		t.Fatalf("Rephrase: %v", err)
	}
	if got.Idiomatic != "Could you take a look at this when you get a chance?" {
		t.Fatalf("Idiomatic: got %q", got.Idiomatic)
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].Text != "Mind taking a look at this?" {
		t.Fatalf("Alternatives: got %+v", got.Alternatives)
	}
}

func TestRephraseNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}`))
	}))
	defer srv.Close()

	m := newTestMiniMax(srv.URL)
	if _, err := m.Rephrase(context.Background(), "帮我看下这个 PR"); err == nil {
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

	m := newTestMiniMax(srv.URL)
	if _, err := m.Rephrase(context.Background(), "帮我看下这个 PR"); err == nil {
		t.Fatal("expected a parse error to propagate, got nil")
	}
}
