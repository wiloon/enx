package middleware

import (
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
