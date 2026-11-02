package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/repo"

	"github.com/gin-gonic/gin"
)

type fakeReviewWords struct {
	words []repo.ReviewWord
	err   error
	asked string
}

func (f *fakeReviewWords) List(_ context.Context, userID string) ([]repo.ReviewWord, error) {
	f.asked = userID
	return f.words, f.err
}

func serveReviewWords(h *ReviewWordsHandler, userID string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me/review-words", nil)
	if userID != "" {
		c.Set("user_id", userID)
	}
	h.List(c)
	return w
}

func TestReviewWordsAnswersCompactPairs(t *testing.T) {
	words := &fakeReviewWords{words: []repo.ReviewWord{{English: "cat", QueryCount: 3}, {English: "don't", QueryCount: 1}}}

	w := serveReviewWords(NewReviewWordsHandler(words), "u1")

	if w.Code != http.StatusOK || w.Body.String() != `[["cat",3],["don't",1]]` {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	if words.asked != "u1" {
		t.Fatalf("listed for %q, want the signed-in user u1", words.asked)
	}
}

func TestReviewWordsAnswersAnEmptyListAsAnEmptyArray(t *testing.T) {
	for _, words := range [][]repo.ReviewWord{nil, {}} {
		w := serveReviewWords(NewReviewWordsHandler(&fakeReviewWords{words: words}), "u1")
		if w.Code != http.StatusOK || w.Body.String() != `[]` {
			t.Fatalf("got %d %s, want 200 []", w.Code, w.Body.String())
		}
	}
}

func TestReviewWordsWithoutAUserIsUnauthorized(t *testing.T) {
	if w := serveReviewWords(NewReviewWordsHandler(&fakeReviewWords{}), ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

func TestReviewWordsStoreErrorIsAServerError(t *testing.T) {
	w := serveReviewWords(NewReviewWordsHandler(&fakeReviewWords{err: errors.New("db down")}), "u1")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", w.Code)
	}
}
