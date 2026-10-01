package openrouter

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func defineWordServer(t *testing.T, status int, body string, captured *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if captured != nil {
			b, _ := io.ReadAll(r.Body)
			*captured = string(b)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

const goodDefinition = `{"choices":[{"message":{"content":"{\"is_word\": true, \"quality\": 9, \"senses\": [{\"pos\": \"n.\", \"zh\": \"很有魅力的人\"}]}"}}],"usage":{"prompt_tokens":150,"completion_tokens":40,"total_tokens":190}}`

func TestDefineWordSuccess(t *testing.T) {
	var sent string
	srv := defineWordServer(t, http.StatusOK, goodDefinition, &sent)

	res, u, err := newTestOpenRouter(srv.URL).DefineWord(context.Background(), "rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsWord || res.Quality != 9 || res.Chinese() != "n. 很有魅力的人" {
		t.Fatalf("result: %+v", res)
	}
	if u.PromptTokens != 150 || u.CompletionTokens != 40 {
		t.Fatalf("usage: %+v", u)
	}
	// Only the word goes to the model: no sentence, nothing else.
	if !strings.Contains(sent, "Word: rizzler") {
		t.Fatalf("request does not carry the word: %s", sent)
	}
}

func TestDefineWordNotAWord(t *testing.T) {
	srv := defineWordServer(t, http.StatusOK,
		`{"choices":[{"message":{"content":"{\"is_word\": false, \"quality\": 0, \"senses\": []}"}}],"usage":{"prompt_tokens":150,"completion_tokens":12,"total_tokens":162}}`, nil)

	res, u, err := newTestOpenRouter(srv.URL).DefineWord(context.Background(), "asdfgh")
	if err != nil || res.IsWord {
		t.Fatalf("got %+v, %v; want a clean not-a-word", res, err)
	}
	if u.CompletionTokens != 12 {
		t.Fatalf("a not-a-word reply still used tokens: %+v", u)
	}
}

// A reply that fails validation is an error, but the tokens it cost are
// still reported so the caller can bill them.
func TestDefineWordRejectsAnInvalidReplyButReportsUsage(t *testing.T) {
	srv := defineWordServer(t, http.StatusOK,
		`{"choices":[{"message":{"content":"It means something nice."}}],"usage":{"prompt_tokens":150,"completion_tokens":9,"total_tokens":159}}`, nil)

	_, u, err := newTestOpenRouter(srv.URL).DefineWord(context.Background(), "rizzler")
	if err == nil {
		t.Fatal("expected an error for a reply that is not the JSON contract")
	}
	if u.PromptTokens != 150 || u.CompletionTokens != 9 {
		t.Fatalf("usage should survive a rejected reply: %+v", u)
	}
}

func TestDefineWordNon200(t *testing.T) {
	srv := defineWordServer(t, http.StatusUnauthorized, `{"error":"invalid api key"}`, nil)

	if _, _, err := newTestOpenRouter(srv.URL).DefineWord(context.Background(), "rizzler"); err == nil {
		t.Fatal("expected an error")
	}
}
