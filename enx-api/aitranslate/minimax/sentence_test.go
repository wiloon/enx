package minimax

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranslateSentenceAsksForSimplifiedChinese(t *testing.T) {
	var body struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"你好世界"}}]}`))
	}))
	defer srv.Close()

	if _, _, err := newTestMiniMax(srv.URL).TranslateSentence(context.Background(), "Hello world"); err != nil {
		t.Fatalf("TranslateSentence: %v", err)
	}
	if len(body.Messages) == 0 || body.Messages[0].Role != "system" {
		t.Fatalf("messages = %+v, want a system message first", body.Messages)
	}
	if !strings.Contains(body.Messages[0].Content, "Simplified Chinese") {
		t.Errorf("system prompt does not ask for Simplified Chinese:\n%s", body.Messages[0].Content)
	}
}
