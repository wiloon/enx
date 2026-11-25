package minimax

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/aitranslate/aiusage"
)

// The JSON features retry a reply that does not parse once, never a failed
// request, and bill the tokens of every attempt made. The multi-word sentence
// call is deliberately not retried (see sentencewords_test.go).
var retryingFeatures = []struct {
	name string
	good string // reply content that parses
	call func(m *MiniMax) (aiusage.Usage, error)
}{
	{
		name: "word in context",
		good: `{\"word\":\"银行\"}`,
		call: func(m *MiniMax) (aiusage.Usage, error) {
			_, u, err := m.TranslateWordInContext(context.Background(), "I deposited cash at the bank.", "bank", "")
			return u, err
		},
	},
}

// replies serves the given (status, content) pairs in order, each billed
// 10 prompt + 5 completion tokens, and counts the requests.
func replies(t *testing.T, calls *int, seq ...[2]any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		step := seq[min(*calls, len(seq)-1)]
		*calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(step[0].(int))
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"` + step[1].(string) + `"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestRetriesOneMalformedReplyAndSumsUsage(t *testing.T) {
	for _, f := range retryingFeatures {
		t.Run(f.name, func(t *testing.T) {
			var calls int
			srv := replies(t, &calls, [2]any{http.StatusOK, "not json at all"}, [2]any{http.StatusOK, f.good})

			u, err := f.call(newTestMiniMax(srv.URL))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if calls != 2 {
				t.Fatalf("requests: got %d, want 2", calls)
			}
			if u != (aiusage.Usage{PromptTokens: 20, CompletionTokens: 10, TotalTokens: 30}) {
				t.Fatalf("usage: got %+v", u)
			}
		})
	}
}

func TestGivesUpAfterTwoMalformedRepliesAndBillsBoth(t *testing.T) {
	for _, f := range retryingFeatures {
		t.Run(f.name, func(t *testing.T) {
			var calls int
			srv := replies(t, &calls, [2]any{http.StatusOK, "not json at all"})

			u, err := f.call(newTestMiniMax(srv.URL))
			if err == nil {
				t.Fatal("want a parse error")
			}
			if calls != 2 {
				t.Fatalf("requests: got %d, want 2", calls)
			}
			if u.TotalTokens != 30 {
				t.Fatalf("usage: got %+v, want both attempts billed", u)
			}
		})
	}
}

func TestDoesNotRetryAFailedRequest(t *testing.T) {
	for _, f := range retryingFeatures {
		t.Run(f.name, func(t *testing.T) {
			var calls int
			srv := replies(t, &calls, [2]any{http.StatusUnauthorized, "x"})

			if _, err := f.call(newTestMiniMax(srv.URL)); err == nil {
				t.Fatal("want an error")
			}
			if calls != 1 {
				t.Fatalf("requests: got %d, want 1", calls)
			}
		})
	}
}

func TestAFailedRetryStillBillsTheFirstAttempt(t *testing.T) {
	for _, f := range retryingFeatures {
		t.Run(f.name, func(t *testing.T) {
			var calls int
			srv := replies(t, &calls, [2]any{http.StatusOK, "not json at all"}, [2]any{http.StatusUnauthorized, "x"})

			u, err := f.call(newTestMiniMax(srv.URL))
			if err == nil {
				t.Fatal("want an error")
			}
			if calls != 2 {
				t.Fatalf("requests: got %d, want 2", calls)
			}
			if u.TotalTokens != 15 {
				t.Fatalf("usage: got %+v, want the first attempt's 15", u)
			}
		})
	}
}
