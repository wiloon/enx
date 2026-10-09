package main

import (
	"enx-api/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/metrics"
	"enx-api/utils"

	"github.com/gin-gonic/gin"
)

// The browser extension and enx-ui call only the /api routes, so each
// endpoint is registered once, under /api. A second copy at the root was a
// leftover from before the /api prefix and doubled every route label.
func TestLookupRoutesAreRegisteredOnlyUnderAPI(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)

	registered := map[string]bool{}
	for _, r := range setupRouter(config.Default(), metrics.New()).Routes() {
		registered[r.Method+" "+r.Path] = true
	}

	for _, route := range []string{
		"GET /paragraph-init",
		"GET /translate",
		"GET /word/:word",
		"POST /translate/sentence",
		"POST /translate/word-in-context",
		"POST /translate/sentence-with-word",
		"POST /rephrase",
		"GET /load-count",
		"POST /mark",
	} {
		if registered[route] {
			t.Errorf("%s is registered at the root; it should exist only under /api", route)
		}
		method, path, _ := strings.Cut(route, " ")
		if !registered[method+" /api"+path] {
			t.Errorf("%s /api%s is not registered", method, path)
		}
	}
}

// Routes with no remaining caller are gone: DELETE /api/word/:word moved to
// the admin group, and /api/wrap had no client at all.
func TestRemovedRoutesAreNotRegistered(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)

	for _, r := range setupRouter(config.Default(), metrics.New()).Routes() {
		switch r.Method + " " + r.Path {
		case "DELETE /api/word/:word", "GET /api/wrap":
			t.Errorf("%s %s is still registered", r.Method, r.Path)
		}
	}
}

// ADR-041: paragraph-init takes its paragraph in a body via QUERY (default)
// or POST (fallback); the GET form stays until old extensions are gone.
func TestParagraphInitRoutes(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)

	registered := map[string]bool{}
	for _, r := range setupRouter(config.Default(), metrics.New()).Routes() {
		registered[r.Method+" "+r.Path] = true
	}
	for _, route := range []string{"QUERY /api/paragraph-init", "POST /api/paragraph-init", "GET /api/paragraph-init"} {
		if !registered[route] {
			t.Errorf("%s is not registered", route)
		}
	}
}

// A cross-origin QUERY is preflighted; the preflight must allow it.
func TestCORSPreflightAllowsQuery(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/paragraph-init", nil)
	req.Header.Set("Origin", "chrome-extension://abcdefghijklmnop")
	req.Header.Set("Access-Control-Request-Method", "QUERY")
	setupRouter(config.Default(), metrics.New()).ServeHTTP(w, req)

	if !strings.Contains(w.Header().Get("Access-Control-Allow-Methods"), "QUERY") {
		t.Fatalf("Access-Control-Allow-Methods = %q, want QUERY listed", w.Header().Get("Access-Control-Allow-Methods"))
	}
}

// Production runs at the default log level, so gin must not stay in debug
// mode there (it dumps every route and warns on each start).
func TestGinModeFollowsLogLevel(t *testing.T) {
	cases := map[string]string{
		"debug":   gin.DebugMode,
		" DEBUG ": gin.DebugMode,
		"info":    gin.ReleaseMode,
		"warn":    gin.ReleaseMode,
		"":        gin.ReleaseMode,
	}
	for level, want := range cases {
		if got := ginMode(level); got != want {
			t.Errorf("ginMode(%q) = %q, want %q", level, got, want)
		}
	}
}

// ADR-044: the preference routes exist under /api and sit behind the session
// check -- a request with no credentials never reaches the handler.
func TestPreferencesRoutesRequireAuthentication(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)
	router := setupRouter(config.Default(), metrics.New())

	registered := map[string]bool{}
	for _, r := range router.Routes() {
		registered[r.Method+" "+r.Path] = true
	}
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		if !registered[method+" /api/me/preferences"] {
			t.Errorf("%s /api/me/preferences is not registered", method)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(method, "/api/me/preferences", strings.NewReader(`{"aiWordFallback":true}`)))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s /api/me/preferences without credentials: status %d, want 401", method, w.Code)
		}
	}
}

// The word list is the user's own data: the route sits behind the session
// check like the rest of /api/me.
func TestWordListRouteRequiresAuthentication(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)
	router := setupRouter(config.Default(), metrics.New())

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/me/words", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("GET /api/me/words without credentials: status %d, want 401", w.Code)
	}
}
