package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	allowed := []string{"chrome-extension://configured-id", "https://catglish.com", "moz-extension://configured-id"}
	router := gin.New()
	router.Use(CORS(allowed))
	router.GET("/ping", func(c *gin.Context) { c.Status(http.StatusOK) })
	for _, origin := range []string{"chrome-extension://configured-id", "chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf", "chrome-extension://other", "moz-extension://configured-id", "https://enx.wiloon.com", "https://enx.wiloon.lab", "http://localhost:3000", "https://catglish.com", "null", ""} {
		t.Run(origin, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/ping", nil)
			req.Header.Set("Origin", origin)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", w.Code)
			}
			if origin == "chrome-extension://configured-id" {
				if got := w.Header().Get("Access-Control-Allow-Origin"); got != origin {
					t.Errorf("allowed origin = %q, want %q", got, origin)
				}
			} else {
				for key, value := range w.Header() {
					if strings.HasPrefix(key, "Access-Control-") {
						t.Errorf("unexpected %s: %q", key, value)
					}
				}
			}
		})
	}
}

func TestCORSPreflightContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const extension = "chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf"
	for _, origin := range []string{extension, "chrome-extension://other", "moz-extension://other", "https://enx.wiloon.com", "https://enx.wiloon.lab", "http://localhost:3000", "https://catglish.com", "null", ""} {
		for _, method := range []string{http.MethodGet, http.MethodOptions} {
			t.Run(method+"/"+origin, func(t *testing.T) {
				router := gin.New()
				router.Use(CORS([]string{extension, "https://catglish.com", "null", ""}))
				router.Any("/resource", func(c *gin.Context) { c.String(http.StatusAccepted, "handler reached") })
				req := httptest.NewRequest(method, "/resource", nil)
				req.Header.Set("Origin", origin)
				req.Header.Set("Access-Control-Request-Method", "QUERY")
				req.Header.Set("Access-Control-Request-Headers", "Authorization, X-Enx-Tz-Offset")
				w := httptest.NewRecorder()
				router.ServeHTTP(w, req)
				if method == http.MethodOptions {
					if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
						t.Fatalf("preflight = %d %q, want empty 204", w.Code, w.Body.String())
					}
				} else if w.Code != http.StatusAccepted || w.Body.String() != "handler reached" {
					t.Fatalf("request = %d %q, want handler response", w.Code, w.Body.String())
				}
				want := map[string]string{}
				if origin == extension {
					want = map[string]string{
						"Access-Control-Allow-Origin":      extension,
						"Access-Control-Allow-Credentials": "true",
						"Access-Control-Allow-Methods":     "GET, POST, QUERY, OPTIONS, PUT, DELETE",
						"Access-Control-Allow-Headers":     "Origin, Authorization, X-Session-ID, X-User-ID, Content-Type, Cookie, X-Enx-Tz-Offset",
						"Access-Control-Expose-Headers":    "Content-Length",
						"Access-Control-Max-Age":           "43200",
					}
				}
				for key, value := range want {
					if got := w.Header().Get(key); got != value {
						t.Errorf("%s = %q, want %q", key, got, value)
					}
				}
				for key := range w.Header() {
					if strings.HasPrefix(key, "Access-Control-") {
						if _, ok := want[key]; !ok {
							t.Errorf("unexpected CORS header %s", key)
						}
					}
				}
			})
		}
	}
}
