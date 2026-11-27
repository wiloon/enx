package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"enx-api/aitranslate"
	"enx-api/aitranslate/worddef"
	"enx-api/config"
	"enx-api/dictionary"
)

// Define-word from AIDefiner through a real provider to an httptest server.
func TestAIDefinerThroughARealProvider(t *testing.T) {
	for _, tc := range []struct {
		name, reply string
		want        dictionary.Definition
		wantErr     error
	}{
		{
			name:  "an answer",
			reply: `{"is_word":true,"quality":9,"senses":[{"pos":"n.","zh":"很有魅力的人"}]}`,
			want:  dictionary.Definition{IsWord: true, Quality: 9, Chinese: "n. 很有魅力的人"},
		},
		{name: "an unusable reply", reply: "not json at all", wantErr: dictionary.ErrInvalidAIReply},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var bodies []map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				var body map[string]any
				if err := json.Unmarshal(raw, &body); err != nil {
					t.Errorf("decode request body %q: %v", raw, err)
				}
				bodies = append(bodies, body)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"choices": []any{map[string]any{"message": map[string]any{"content": tc.reply}}},
					"usage":   map[string]any{"prompt_tokens": 150, "completion_tokens": 40, "total_tokens": 190},
				})
			}))
			defer srv.Close()
			provider, err := aitranslate.New(context.Background(), config.SentenceTranslate{
				Provider:       "deepseek",
				RequestTimeout: 5 * time.Second,
				DeepSeek:       config.OpenAICompatible{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"},
			})
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			definer, ok := aitranslate.AsWordDefiner(provider)
			if !ok {
				t.Fatal("deepseek should define words")
			}

			got, usage, err := AIDefiner{Definer: definer}.DefineWord(context.Background(), "rizzler")

			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("definition = %+v, want %+v", got, tc.want)
			}
			if want := (dictionary.AIUsage{PromptTokens: 150, CompletionTokens: 40}); usage != want {
				t.Errorf("usage = %+v, want %+v", usage, want)
			}
			wantBody := map[string]any{
				"model": "test-model",
				"messages": []any{
					map[string]any{"role": "system", "content": worddef.SystemPrompt},
					map[string]any{"role": "user", "content": worddef.BuildUserContent("rizzler")},
				},
				"temperature": worddef.Temperature,
				"thinking":    map[string]any{"type": "disabled"},
			}
			if len(bodies) != 1 || !reflect.DeepEqual(bodies[0], wantBody) {
				t.Errorf("requests = %v, want one %v", bodies, wantBody)
			}
		})
	}
}
