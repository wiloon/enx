package paragraph

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/enx"

	"github.com/gin-gonic/gin"
)

type fakeTextWords struct {
	words map[string]enx.Word
	err   error
}

func (f fakeTextWords) In(context.Context, string, string) (map[string]enx.Word, error) {
	return f.words, f.err
}

func serve(h *Handler, userID string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/paragraph-init?paragraph=run", nil)
	if userID != "" {
		c.Set("user_id", userID)
	}
	h.ParagraphInit(c)
	return w
}

func TestParagraphInit(t *testing.T) {
	ok := fakeTextWords{words: map[string]enx.Word{"run": {Id: "w1", LoadCount: 2}}}

	if w := serve(NewHandler(ok), ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("no user: status %d, want 401", w.Code)
	}
	if w := serve(NewHandler(fakeTextWords{err: errors.New("db down")}), "u1"); w.Code != http.StatusInternalServerError {
		t.Fatalf("store error: status %d, want 500", w.Code)
	}

	w := serve(NewHandler(ok), "u1")
	var body struct{ Data map[string]enx.Word }
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || body.Data["run"].Id != "w1" || body.Data["run"].LoadCount != 2 {
		t.Fatalf("got %d %+v", w.Code, body)
	}
}
