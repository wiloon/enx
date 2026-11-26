package openaicompat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"enx-api/aitranslate/aiusage"

	"github.com/go-resty/resty/v2"
)

func TestChatSendsThePromptAndReturnsTheReplyWithItsUsage(t *testing.T) {
	var gotPath, gotQuery, gotAuth, gotType, gotTitle string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		gotAuth, gotType, gotTitle = r.Header.Get("Authorization"), r.Header.Get("Content-Type"), r.Header.Get("X-Title")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"你好"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`))
	}))
	defer srv.Close()

	out, u, err := Chat(context.Background(), resty.New().SetTimeout(5*time.Second), Endpoint{
		Provider: "acme",
		BaseURL:  srv.URL,
		APIKey:   "k",
		Headers:  map[string]string{"X-Title": "Catglish"},
		Query:    map[string]string{"GroupId": "g"},
		Extra:    map[string]any{"thinking": map[string]string{"type": "disabled"}},
	}, Prompt{Feature: "f", Model: "m", Temperature: 0.5, System: "sys", User: "Hello"})

	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if out != "你好" {
		t.Errorf("reply = %q, want 你好", out)
	}
	if want := (aiusage.Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5}); u != want {
		t.Errorf("usage = %+v, want %+v", u, want)
	}
	if gotPath != "/chat/completions" || gotQuery != "GroupId=g" {
		t.Errorf("url = %s?%s, want /chat/completions?GroupId=g", gotPath, gotQuery)
	}
	if gotAuth != "Bearer k" || gotType != "application/json" || gotTitle != "Catglish" {
		t.Errorf("headers = %q %q %q, want Bearer k, application/json, Catglish", gotAuth, gotType, gotTitle)
	}
	wantBody := map[string]any{
		"model":       "m",
		"temperature": 0.5,
		"messages": []any{
			map[string]any{"role": "system", "content": "sys"},
			map[string]any{"role": "user", "content": "Hello"},
		},
		"thinking": map[string]any{"type": "disabled"},
	}
	if !reflect.DeepEqual(gotBody, wantBody) {
		t.Errorf("body = %v, want %v", gotBody, wantBody)
	}
}

// The model ran, so its usage comes back with the error and the caller can
// bill it (ADR-094).
func TestChatReturnsTheUsageOfAReplyWithNoChoices(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`))
	}))
	defer srv.Close()

	_, u, err := Chat(context.Background(), resty.New(), Endpoint{Provider: "acme", BaseURL: srv.URL, APIKey: "k"}, Prompt{User: "Hello"})

	if err == nil || err.Error() != "acme: empty response" {
		t.Errorf("err = %v, want acme: empty response", err)
	}
	if want := (aiusage.Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5}); u != want {
		t.Errorf("usage = %+v, want %+v", u, want)
	}
}

func TestChatErrorsNameTheProvider(t *testing.T) {
	cases := []struct {
		name   string
		status int
		reply  string
		want   string
	}{
		{"unexpected status", http.StatusTooManyRequests, `slow down`, "acme: unexpected status 429: slow down"},
		{"no choices", http.StatusOK, `{"choices":[]}`, "acme: empty response"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.reply))
			}))
			defer srv.Close()

			_, _, err := Chat(context.Background(), resty.New(), Endpoint{Provider: "acme", BaseURL: srv.URL, APIKey: "k"}, Prompt{User: "Hello"})
			if err == nil || err.Error() != tc.want {
				t.Errorf("err = %v, want %q", err, tc.want)
			}
		})
	}
}
