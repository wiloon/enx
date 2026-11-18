package httpjson_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/platform/httpjson"

	"github.com/gin-gonic/gin"
)

func TestFailWritesStatusAndFailureBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	httpjson.Fail(c, http.StatusConflict, "word already exists")

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusConflict)
	}
	const want = `{"message":"word already exists","success":false}`
	if got := w.Body.String(); got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
}
