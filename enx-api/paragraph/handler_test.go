package paragraph

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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

// capturingTextWords records the paragraph it was asked about.
type capturingTextWords struct{ got *string }

func (c capturingTextWords) In(_ context.Context, paragraph, _ string) (map[string]enx.Word, error) {
	*c.got = paragraph
	return map[string]enx.Word{}, nil
}

func serveBody(h *Handler, method, contentType, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/paragraph-init", strings.NewReader(body))
	if contentType != "" {
		c.Request.Header.Set("Content-Type", contentType)
	}
	c.Set("user_id", "u1")
	h.ParagraphInitBody(c)
	return w
}

// QUERY (RFC 10008) is the default; POST is the fallback for networks that
// drop unknown methods. Both carry the paragraph in a JSON body.
func TestParagraphInitBodyMethods(t *testing.T) {
	for _, method := range []string{"QUERY", http.MethodPost} {
		var got string
		w := serveBody(NewHandler(capturingTextWords{&got}), method, "application/json; charset=utf-8", `{"paragraph":"good morning"}`)
		if w.Code != http.StatusOK || got != "good morning" {
			t.Fatalf("%s: status %d, paragraph %q; want 200 and the body's paragraph", method, w.Code, got)
		}
		if w.Header().Get("Accept-Query") != "application/json" {
			t.Fatalf("%s: Accept-Query = %q, want application/json", method, w.Header().Get("Accept-Query"))
		}
	}
}

// RFC 10008: a QUERY with a missing or inconsistent Content-Type fails.
func TestParagraphInitBodyRejectsBadInput(t *testing.T) {
	var got string
	h := NewHandler(capturingTextWords{&got})
	for _, tc := range []struct {
		contentType, body string
		want              int
	}{
		{"", `{"paragraph":"x"}`, http.StatusUnsupportedMediaType},
		{"text/plain", `{"paragraph":"x"}`, http.StatusUnsupportedMediaType},
		{"application/json", `{"paragraph":`, http.StatusBadRequest},
	} {
		if w := serveBody(h, "QUERY", tc.contentType, tc.body); w.Code != tc.want {
			t.Errorf("Content-Type %q body %q: status %d, want %d", tc.contentType, tc.body, w.Code, tc.want)
		}
	}
	if got != "" {
		t.Fatalf("rejected requests reached the lookup: %q", got)
	}
}

// The deprecated GET form keeps working until old extension builds are gone.
func TestParagraphInitDeprecatedGetStillServes(t *testing.T) {
	var got string
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/paragraph-init?paragraph=good+morning", nil)
	c.Set("user_id", "u1")
	NewHandler(capturingTextWords{&got}).ParagraphInit(c)
	if w.Code != http.StatusOK || got != "good morning" {
		t.Fatalf("status %d, paragraph %q", w.Code, got)
	}
}
