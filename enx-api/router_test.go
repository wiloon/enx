package main

import (
	"enx-api/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/metrics"

	"github.com/gin-gonic/gin"
)

// The browser extension and enx-ui call only the /api routes, so each
// endpoint is registered once, under /api. A second copy at the root was a
// leftover from before the /api prefix and doubled every route label.
func TestLookupRoutesAreRegisteredOnlyUnderAPI(t *testing.T) {
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
		"PUT /me/words/:english/known",
		"DELETE /me/words/:english/known",
		"POST /me/word-lookups",
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
// the admin group, /api/wrap had no client at all, and the toggle POST
// /api/mark gave way to PUT/DELETE /api/me/words/:english/known (#133).
func TestRemovedRoutesAreNotRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, r := range setupRouter(config.Default(), metrics.New()).Routes() {
		switch r.Method + " " + r.Path {
		case "DELETE /api/word/:word", "GET /api/wrap", "POST /api/mark":
			t.Errorf("%s %s is still registered", r.Method, r.Path)
		}
	}
}

// ADR-041: paragraph-init takes its paragraph in a body via QUERY (default)
// or POST (fallback); the GET form stays until old extensions are gone.
func TestParagraphInitRoutes(t *testing.T) {
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

// ADR-051: the invite API. me and claim need a session; the offer is for the
// signed-out landing page.
func TestReferralRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	registered := map[string]bool{}
	for _, r := range setupRouter(config.Default(), metrics.New()).Routes() {
		registered[r.Method+" "+r.Path] = true
	}
	for _, route := range []string{"GET /api/referral/me", "POST /api/referral/claim", "GET /api/referral/offer"} {
		if !registered[route] {
			t.Errorf("%s is not registered", route)
		}
	}

	w := httptest.NewRecorder()
	setupRouter(config.Default(), metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/referral/offer", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"credits":200`) || !strings.Contains(w.Body.String(), `"days":14`) {
		t.Fatalf("signed-out GET /api/referral/offer = %d %s, want 200 with the default 200 credits / 14 days", w.Code, w.Body.String())
	}
}

// A cross-origin QUERY is preflighted; the preflight must allow it.
func TestCORSPreflightAllowsQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/paragraph-init", nil)
	req.Header.Set("Origin", "chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf")
	req.Header.Set("Access-Control-Request-Method", "QUERY")
	cfg := config.Default()
	cfg.Clerk.AuthorizedParties = []string{"chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf"}
	setupRouter(cfg, metrics.New()).ServeHTTP(w, req)

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
	gin.SetMode(gin.TestMode)
	router := setupRouter(clerkConfig(t), metrics.New())

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
	gin.SetMode(gin.TestMode)
	router := setupRouter(clerkConfig(t), metrics.New())

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/me/words", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("GET /api/me/words without credentials: status %d, want 401", w.Code)
	}
}

// Marking a word known is the user's own data, behind the session check.
func TestWordKnownRoutesRequireAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupRouter(clerkConfig(t), metrics.New())

	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(method, "/api/me/words/hello/known", nil))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s /api/me/words/hello/known without credentials: status %d, want 401", method, w.Code)
		}
	}
}

// The ops user-stats endpoint is for Grafana, which has no Clerk session: it
// takes the OPS_STATS_TOKEN bearer instead, and is absent without one
// (ADR-058 Decision 4).
func TestOpsUserStatsRouteUsesTheOpsTokenNotClerk(t *testing.T) {
	gin.SetMode(gin.TestMode)
	reversed := "/api/ops/user-stats/daily?from=2026-10-16&to=2026-10-15"
	request := func(cfg *config.Config, auth string) int {
		req := httptest.NewRequest(http.MethodGet, reversed, nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		w := httptest.NewRecorder()
		setupRouter(cfg, metrics.New()).ServeHTTP(w, req)
		return w.Code
	}

	cfg := clerkConfig(t)
	if got := request(cfg, "Bearer anything"); got != http.StatusNotFound {
		t.Errorf("without OPS_STATS_TOKEN: status %d, want 404", got)
	}

	cfg.Ops.StatsToken = "ops-token"
	if got := request(cfg, "Bearer ops-token"); got != http.StatusBadRequest {
		t.Errorf("with the token and a reversed range: status %d, want 400 from the handler", got)
	}
	if got := request(cfg, "Bearer wrong"); got != http.StatusUnauthorized {
		t.Errorf("with a wrong token: status %d, want 401", got)
	}
}

// Recording a lookup writes the user's own query count, behind the session
// check.
func TestWordLookupRouteRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupRouter(clerkConfig(t), metrics.New())

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/me/word-lookups", strings.NewReader(`{"wordId":"w1"}`)))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("POST /api/me/word-lookups without credentials: status %d, want 401", w.Code)
	}
}

func TestCORSUsesOnlyConfiguredChromeExtensions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := config.Default()
	cfg.Clerk.AuthorizedParties = []string{"chrome-extension://configured-id", "https://catglish.com", "moz-extension://configured-id"}
	router := setupRouter(cfg, metrics.New())
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
