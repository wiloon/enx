package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTrialTerms(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name    string
		amount  int64
		ttlDays int
		want    string
	}{
		{"configured offer", 100, 30, `{"amount":100,"ttl_days":30}`},
		{"amount zero is off", 0, 30, `{"amount":0,"ttl_days":0}`},
		{"ttl zero is off", 100, 0, `{"amount":0,"ttl_days":0}`},
		{"both zero is off", 0, 0, `{"amount":0,"ttl_days":0}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.GET("/api/billing/trial-terms", TrialTerms(tc.amount, tc.ttlDays))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/billing/trial-terms", nil))
			if w.Code != http.StatusOK || w.Body.String() != tc.want {
				t.Fatalf("got %d %s, want 200 %s", w.Code, w.Body.String(), tc.want)
			}
		})
	}
}
