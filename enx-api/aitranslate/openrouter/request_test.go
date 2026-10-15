package openrouter

import (
	"context"
	"encoding/json"
	"enx-api/config"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// sentRequest is the part of the Chat Completions body these tests inspect.
type sentRequest struct {
	Model     string `json:"model"`
	Reasoning *struct {
		Enabled *bool `json:"enabled"`
	} `json:"reasoning"`
}

// captureServer answers every request with a minimal valid reply and
// records each request body it received.
func captureServer(t *testing.T, reply string) (*httptest.Server, *[]sentRequest) {
	t.Helper()
	var got []sentRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req sentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
		}
		got = append(got, req)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

const translateReply = `{"choices":[{"message":{"role":"assistant","content":"你好"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`

const rephraseReply = `{"choices":[{"message":{"role":"assistant","content":"{\"idiomatic\":\"Hi\",\"alternatives\":[{\"text\":\"Hey\",\"register\":\"casual\"}],\"notes\":[]}"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`

func TestRequestsUseDeepSeekV41FlashByDefault(t *testing.T) {
	srv, got := captureServer(t, translateReply)
	o, err := New(config.OpenAICompatible{APIKey: "key", BaseURL: srv.URL}, 5*time.Second)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if _, _, err := o.TranslateSentence(context.Background(), "Hello"); err != nil {
		t.Fatalf("TranslateSentence: %v", err)
	}
	if (*got)[0].Model != "deepseek/deepseek-v4.1-flash" {
		t.Errorf("model = %q, want deepseek/deepseek-v4.1-flash", (*got)[0].Model)
	}
}

// OpenRouter turns reasoning on by default for models that support it
// (deepseek-v4.1-flash: default_enabled, effort high), which makes a
// one-line translation several times slower. Every feature must switch it off.
func TestRequestsTurnReasoningOff(t *testing.T) {
	cases := []struct {
		name  string
		reply string
		call  func(o *OpenRouter) error
	}{
		{"translate sentence", translateReply, func(o *OpenRouter) error {
			_, _, err := o.TranslateSentence(context.Background(), "Hello")
			return err
		}},
		{"rephrase", rephraseReply, func(o *OpenRouter) error {
			_, err := o.Rephrase(context.Background(), "你好")
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, got := captureServer(t, tc.reply)
			if err := tc.call(newTestOpenRouter(srv.URL)); err != nil {
				t.Fatalf("call: %v", err)
			}
			r := (*got)[0].Reasoning
			if r == nil || r.Enabled == nil || *r.Enabled {
				t.Errorf("reasoning = %+v, want {enabled: false}", r)
			}
		})
	}
}
