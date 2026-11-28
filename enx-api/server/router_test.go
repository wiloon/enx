package server

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
	for _, r := range setupRouter(nil, config.Default(), metrics.New()).Routes() {
		registered[r.Method+" "+r.Path] = true
	}

	for _, route := range []string{
		"GET /translate",
		"GET /word/:word",
		"QUERY /dictionary/entries",
		"POST /dictionary/entries/query",
		"POST /translate/sentence",
		"POST /translate/word-in-context",
		"POST /translate/sentence-with-words",
		"POST /rephrase",
		"PUT /me/words/:english/known",
		"DELETE /me/words/:english/known",
		"POST /me/word-lookups",
		"GET /me/review/session",
		"POST /me/review/answers",
		"GET /me/review-words",
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
// the admin group, /api/wrap had no client at all, the toggle POST
// /api/mark gave way to PUT/DELETE /api/me/words/:english/known (#133), and
// the single-word POST /api/translate/sentence-with-word gave way to
// /api/translate/sentence-with-words (ADR-023 Decision 9, #1135).
func TestRemovedRoutesAreNotRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, r := range setupRouter(nil, config.Default(), metrics.New()).Routes() {
		switch r.Method + " " + r.Path {
		case "DELETE /api/word/:word", "GET /api/wrap", "POST /api/mark",
			"POST /api/translate/sentence-with-word":
			t.Errorf("%s %s is still registered", r.Method, r.Path)
		}
	}
}

// No extension build ever shipped a call to the single-word endpoint, so a
// request to it is a plain 404 rather than a translation (#1135).
func TestSentenceWithWordReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	body := strings.NewReader(`{"sentence":"A fox.","word":"fox"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/translate/sentence-with-word", body)
	req.Header.Set("Content-Type", "application/json")
	setupRouter(nil, config.Default(), metrics.New()).ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("POST /api/translate/sentence-with-word = %d %s, want 404", w.Code, w.Body.String())
	}
}

// paragraph-init is gone: GET /api/me/review-words replaced it (ADR-069) and
// no extension build calls the old endpoint any more (#598).
func TestParagraphInitIsNotRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)

	registered := map[string]bool{}
	for _, r := range setupRouter(nil, config.Default(), metrics.New()).Routes() {
		registered[r.Method+" "+r.Path] = true
	}
	for _, route := range []string{"QUERY /api/paragraph-init", "POST /api/paragraph-init", "GET /api/paragraph-init"} {
		if registered[route] {
			t.Errorf("%s is still registered", route)
		}
	}
}

// ADR-051: the invite API. me and claim need a session; the offer is for the
// signed-out landing page.
func TestReferralRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	registered := map[string]bool{}
	for _, r := range setupRouter(nil, config.Default(), metrics.New()).Routes() {
		registered[r.Method+" "+r.Path] = true
	}
	for _, route := range []string{"GET /api/referral/me", "POST /api/referral/claim", "GET /api/referral/offer"} {
		if !registered[route] {
			t.Errorf("%s is not registered", route)
		}
	}

	w := httptest.NewRecorder()
	setupRouter(nil, config.Default(), metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/referral/offer", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"credits":200`) || !strings.Contains(w.Body.String(), `"days":30`) {
		t.Fatalf("signed-out GET /api/referral/offer = %d %s, want 200 with the default 200 credits / 30 days", w.Code, w.Body.String())
	}
}

// ADR-098 Decision 9 / #1238: pricing and /welcome read the sign-up trial
// terms without a session. Off is amount=0 or ttl-days=0 → both fields 0.
func TestTrialTermsRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	setupRouter(nil, config.Default(), metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/billing/trial-terms", nil))
	if w.Code != http.StatusOK || w.Body.String() != `{"amount":100,"ttl_days":30}` {
		t.Fatalf("signed-out GET /api/billing/trial-terms = %d %s, want 200 with {\"amount\":100,\"ttl_days\":30}", w.Code, w.Body.String())
	}

	t.Run("amount zero is off", func(t *testing.T) {
		t.Chdir(t.TempDir())
		t.Setenv("HOME", t.TempDir())
		t.Setenv("CREDITS_TRIAL_AMOUNT", "0")
		cfg, err := config.Load("")
		if err != nil {
			t.Fatalf("config.Load: %v", err)
		}
		w := httptest.NewRecorder()
		setupRouter(nil, cfg, metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/billing/trial-terms", nil))
		if w.Code != http.StatusOK || w.Body.String() != `{"amount":0,"ttl_days":0}` {
			t.Fatalf("amount=0 GET /api/billing/trial-terms = %d %s, want 200 with {\"amount\":0,\"ttl_days\":0}", w.Code, w.Body.String())
		}
	})

	t.Run("ttl-days zero is off", func(t *testing.T) {
		t.Chdir(t.TempDir())
		t.Setenv("HOME", t.TempDir())
		t.Setenv("CREDITS_TRIAL_TTL_DAYS", "0")
		cfg, err := config.Load("")
		if err != nil {
			t.Fatalf("config.Load: %v", err)
		}
		w := httptest.NewRecorder()
		setupRouter(nil, cfg, metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/billing/trial-terms", nil))
		if w.Code != http.StatusOK || w.Body.String() != `{"amount":0,"ttl_days":0}` {
			t.Fatalf("ttl-days=0 GET /api/billing/trial-terms = %d %s, want 200 with {\"amount\":0,\"ttl_days\":0}", w.Code, w.Body.String())
		}
	})
}

// ADR-029: the pricing page reads the free daily lookup ceiling without a
// session. Exact one-field payload: the subscribed ceiling stays off the wire.
func TestFreeDailyLookupLimitRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	setupRouter(nil, config.Default(), metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/dictionary/free-daily-lookup-limit", nil))
	if w.Code != http.StatusOK || w.Body.String() != `{"free_daily_lookup_limit":2000}` {
		t.Fatalf("signed-out GET /api/dictionary/free-daily-lookup-limit = %d %s, want 200 with {\"free_daily_lookup_limit\":2000}", w.Code, w.Body.String())
	}

	t.Chdir(t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("STRIPE_QUOTA_DICTIONARY_LOOKUP_DAILY_FREE", "3456")
	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	w = httptest.NewRecorder()
	setupRouter(nil, cfg, metrics.New()).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/dictionary/free-daily-lookup-limit", nil))
	if w.Code != http.StatusOK || w.Body.String() != `{"free_daily_lookup_limit":3456}` {
		t.Fatalf("env-overridden GET /api/dictionary/free-daily-lookup-limit = %d %s, want 200 with {\"free_daily_lookup_limit\":3456}", w.Code, w.Body.String())
	}
}

// A cross-origin QUERY is preflighted; the preflight must allow it.
func TestCORSPreflightAllowsQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/dictionary/entries", nil)
	req.Header.Set("Origin", "chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf")
	req.Header.Set("Access-Control-Request-Method", "QUERY")
	cfg := config.Default()
	cfg.Clerk.AuthorizedParties = []string{"chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf"}
	setupRouter(nil, cfg, metrics.New()).ServeHTTP(w, req)

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
		if got := GinMode(level); got != want {
			t.Errorf("GinMode(%q) = %q, want %q", level, got, want)
		}
	}
}

// Signed-in routes sit behind the session check: a request with no
// credentials never reaches the handler. The check is on the /api group, so
// a 401 also shows the route is registered (an unknown route answers 404).
func TestSignedInRoutesRequireASession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupRouter(nil, clerkConfig(t), metrics.New())

	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/me/preferences"},
		{http.MethodPut, "/api/me/preferences"},
		{http.MethodGet, "/api/me/words"},
		{http.MethodPut, "/api/me/words/hello/known"},
		{http.MethodDelete, "/api/me/words/hello/known"},
		{http.MethodPost, "/api/me/word-lookups"},
		{http.MethodGet, "/api/me/review-words"},
		{http.MethodGet, "/api/me/credits/transactions"},
		{http.MethodPost, "/api/dictionary/ai-word"},
		{http.MethodPost, "/api/feedback"},
		{http.MethodGet, "/api/admin/feedback"},
		{http.MethodPatch, "/api/admin/feedback/f1"},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`)))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without credentials: status %d, want 401", route.method, route.path, w.Code)
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
		setupRouter(nil, cfg, metrics.New()).ServeHTTP(w, req)
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

// ADR-036: overriding the token party list (oidc.authorized-parties) must not
// change which origins CORS allows; that stays on the Clerk origin list.
func TestCORSIgnoresTheOIDCPartyOverride(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := config.Default()
	cfg.Clerk.AuthorizedParties = []string{"chrome-extension://clerk-origin"}
	cfg.OIDC.AuthorizedParties = []string{"logto-app", "chrome-extension://oidc-only"}
	router := setupRouter(nil, cfg, metrics.New())
	for origin, want := range map[string]string{
		"chrome-extension://clerk-origin": "chrome-extension://clerk-origin",
		"chrome-extension://oidc-only":    "",
	} {
		req := httptest.NewRequest(http.MethodGet, "/ping", nil)
		req.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != want {
			t.Errorf("origin %q: Allow-Origin = %q, want %q", origin, got, want)
		}
	}
}

// The router passes the configured authorized parties to the CORS middleware;
// which origins it allows is middleware.TestCORSOrigins.
func TestCORSUsesTheConfiguredAuthorizedParties(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := config.Default()
	cfg.Clerk.AuthorizedParties = []string{"chrome-extension://configured-id"}
	router := setupRouter(nil, cfg, metrics.New())
	for _, origin := range []string{"chrome-extension://configured-id", "chrome-extension://other"} {
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
