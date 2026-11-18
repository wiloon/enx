package aitranslate_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/deepseek"
	"enx-api/aitranslate/gemini"
	"enx-api/aitranslate/kimi"
	"enx-api/aitranslate/minimax"
	"enx-api/aitranslate/openrouter"
	"enx-api/aitranslate/sentence"
	"enx-api/config"
)

// sentenceTranslator is the one call every OpenAI-compatible provider shares.
type sentenceTranslator interface {
	TranslateSentence(ctx context.Context, text string) (string, aiusage.Usage, error)
}

// wireProvider describes what one OpenAI-compatible provider puts on the wire.
type wireProvider struct {
	name  string
	build func(baseURL string) (sentenceTranslator, error)
	// extraBody holds the body fields beyond model, messages and temperature.
	extraBody map[string]any
	headers   map[string]string
	query     string
}

func openAICompatible(baseURL string) config.OpenAICompatible {
	return config.OpenAICompatible{APIKey: "test-key", BaseURL: baseURL, Model: "test-model"}
}

func wireProviders() []wireProvider {
	return []wireProvider{
		{
			name: "deepseek",
			build: func(u string) (sentenceTranslator, error) {
				return deepseek.New(openAICompatible(u), 5*time.Second)
			},
			extraBody: map[string]any{"thinking": map[string]any{"type": "disabled"}},
		},
		{
			name: "gemini",
			build: func(u string) (sentenceTranslator, error) {
				return gemini.New(openAICompatible(u), 5*time.Second)
			},
		},
		{
			name: "kimi",
			build: func(u string) (sentenceTranslator, error) {
				return kimi.New(openAICompatible(u), 5*time.Second)
			},
		},
		{
			name: "openrouter",
			build: func(u string) (sentenceTranslator, error) {
				return openrouter.New(openAICompatible(u), 5*time.Second)
			},
			extraBody: map[string]any{"reasoning": map[string]any{"enabled": false}},
			headers:   map[string]string{"HTTP-Referer": "https://catglish.com", "X-Title": "Catglish"},
		},
		{
			name: "minimax",
			build: func(u string) (sentenceTranslator, error) {
				return minimax.New(config.MiniMax{APIKey: "test-key", BaseURL: u, Model: "test-model", GroupID: "g-1"}, 5*time.Second)
			},
			query: "GroupId=g-1",
		},
	}
}

func (p wireProvider) translator(t *testing.T, baseURL string) sentenceTranslator {
	t.Helper()
	tr, err := p.build(baseURL)
	if err != nil {
		t.Fatalf("%s.New: %v", p.name, err)
	}
	return tr
}

type sentRequest struct {
	method, path, query string
	header              http.Header
	body                map[string]any
}

func replyWith(t *testing.T, status int, reply string) (*httptest.Server, *sentRequest) {
	t.Helper()
	got := &sentRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		*got = sentRequest{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, header: r.Header.Clone()}
		if err := json.Unmarshal(raw, &got.body); err != nil {
			t.Errorf("decode request body %q: %v", raw, err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

func TestEachProviderSendsItsChatCompletionsRequest(t *testing.T) {
	const reply = `{"choices":[{"message":{"role":"assistant","content":"你好"}}],"usage":{"prompt_tokens":11,"completion_tokens":5,"total_tokens":16}}`
	for _, p := range wireProviders() {
		t.Run(p.name, func(t *testing.T) {
			srv, got := replyWith(t, http.StatusOK, reply)

			out, u, err := p.translator(t, srv.URL).TranslateSentence(context.Background(), "Hello")
			if err != nil {
				t.Fatalf("TranslateSentence: %v", err)
			}
			if out != "你好" {
				t.Errorf("translation = %q, want 你好", out)
			}
			if want := (aiusage.Usage{PromptTokens: 11, CompletionTokens: 5, TotalTokens: 16}); u != want {
				t.Errorf("usage = %+v, want %+v", u, want)
			}

			if got.method != http.MethodPost || got.path != "/chat/completions" {
				t.Errorf("request = %s %s, want POST /chat/completions", got.method, got.path)
			}
			if got.query != p.query {
				t.Errorf("query = %q, want %q", got.query, p.query)
			}
			if h := got.header.Get("Authorization"); h != "Bearer test-key" {
				t.Errorf("Authorization = %q, want Bearer test-key", h)
			}
			if h := got.header.Get("Content-Type"); h != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", h)
			}
			for k, v := range p.headers {
				if h := got.header.Get(k); h != v {
					t.Errorf("%s = %q, want %q", k, h, v)
				}
			}

			want := map[string]any{
				"model": "test-model",
				"messages": []any{
					map[string]any{"role": "system", "content": sentence.SystemPrompt},
					map[string]any{"role": "user", "content": "Hello"},
				},
				"temperature": sentence.Temperature,
			}
			for k, v := range p.extraBody {
				want[k] = v
			}
			if !reflect.DeepEqual(got.body, want) {
				t.Errorf("body keys = %v, want %v\nbody = %v\nwant = %v", keys(got.body), keys(want), got.body, want)
			}
		})
	}
}

func TestEachProviderNamesItselfInItsErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		reply  string
		want   func(provider string) string
	}{
		{"unexpected status", http.StatusUnauthorized, `{"error":"bad key"}`, func(p string) string {
			return p + `: unexpected status 401: {"error":"bad key"}`
		}},
		{"no choices", http.StatusOK, `{"choices":[]}`, func(p string) string {
			return p + ": empty response"
		}},
	}
	for _, p := range wireProviders() {
		for _, tc := range cases {
			t.Run(p.name+"/"+tc.name, func(t *testing.T) {
				srv, _ := replyWith(t, tc.status, tc.reply)

				_, _, err := p.translator(t, srv.URL).TranslateSentence(context.Background(), "Hello")
				if err == nil || err.Error() != tc.want(p.name) {
					t.Errorf("err = %v, want %q", err, tc.want(p.name))
				}
			})
		}
	}
}

func TestEachProviderNamesItselfWhenTheRequestFails(t *testing.T) {
	for _, p := range wireProviders() {
		t.Run(p.name, func(t *testing.T) {
			srv := httptest.NewServer(http.NotFoundHandler())
			url := srv.URL
			srv.Close() // nothing listens any more, so the request itself fails

			_, _, err := p.translator(t, url).TranslateSentence(context.Background(), "Hello")
			if err == nil || !strings.HasPrefix(err.Error(), p.name+": request failed: ") {
				t.Errorf("err = %v, want prefix %q", err, p.name+": request failed: ")
			}
		})
	}
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
