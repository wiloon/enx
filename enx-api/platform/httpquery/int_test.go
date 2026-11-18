package httpquery_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/platform/httpquery"

	"github.com/gin-gonic/gin"
)

func TestInt(t *testing.T) {
	cases := []struct {
		name, query string
		want        int
		wantOK      bool
	}{
		{"absent is the default", "", 7, true},
		{"empty is the default", "?limit=", 7, true},
		{"a whole number", "?limit=25", 25, true},
		{"a negative number", "?limit=-3", -3, true},
		{"zero", "?limit=0", 0, true},
		{"a word is refused", "?limit=ten", 0, false},
		{"a fraction is refused", "?limit=1.5", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, "/"+tc.query, nil)

			got, ok := httpquery.Int(c, "limit", 7)

			if got != tc.want || ok != tc.wantOK {
				t.Errorf("Int = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.wantOK)
			}
		})
	}
}
