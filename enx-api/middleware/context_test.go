package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestGetUserIDFromContextPresent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "u1")

	if got := GetUserIDFromContext(c); got != "u1" {
		t.Errorf("got %q, want u1", got)
	}
}

func TestGetUserIDFromContextAbsent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	if got := GetUserIDFromContext(c); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestRequireUserIDReturnsTheSignedInUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "u-1")

	userID, ok := RequireUserID(c, "Invalid session")
	if !ok || userID != "u-1" {
		t.Fatalf("got (%q, %v), want (u-1, true)", userID, ok)
	}
	if c.Writer.Written() {
		t.Fatalf("wrote a response: %d %s", w.Code, w.Body.String())
	}
}

func TestRequireUserIDAnswers401WithoutAUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	userID, ok := RequireUserID(c, "Invalid session")
	if ok || userID != "" {
		t.Fatalf("got (%q, %v), want (\"\", false)", userID, ok)
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
	if got, want := w.Body.String(), `{"message":"Invalid session","success":false}`; got != want {
		t.Fatalf("body %s, want %s", got, want)
	}
}
