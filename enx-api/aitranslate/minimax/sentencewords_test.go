package minimax

import (
	"context"
	"net/http"
	"testing"

	"enx-api/aitranslate/sentenceword"
)

func TestTranslateSentenceWithWordsDoesNotRetryMissingSentence(t *testing.T) {
	var calls int
	srv := replies(t, &calls,
		[2]any{http.StatusOK, `{\"words\":[{\"word\":\"bank\",\"chinese\":\"银行\"}]}`},
		[2]any{http.StatusOK, `{\"sentence\":\"我在银行存了现金。\",\"words\":[]}`},
	)

	_, _, err := newTestMiniMax(srv.URL).TranslateSentenceWithWords(context.Background(),
		"I deposited cash at the bank.", []sentenceword.WordInput{{Word: "bank"}})
	if calls != 1 || err == nil {
		t.Fatalf("got %d provider requests and error %v, want one request and a parse error", calls, err)
	}
}
