package word

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLoadCountRejectsUnauthenticatedRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/word/load-count", LoadCount)

	req := httptest.NewRequest(http.MethodGet, "/word/load-count?words=hello", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}
