package server

import (
	"encoding/json"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/platform/clerktest"
	"enx-api/utils/sqlitex"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// e2eServer creates a real httptest.Server backed by the full application router.
// The returned cleanup function must be called when the test is done.
func e2eServer(t *testing.T, cfg *config.Config) (*httptest.Server, func()) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := setupRouter(cfg, metrics.New())
	ts := httptest.NewServer(router)
	return ts, func() { ts.Close() }
}

// clerkConfig is the default config with Clerk pointed at a local test JWKS,
// so /api answers 401 to a missing token rather than 503 (Clerk unconfigured).
func clerkConfig(t *testing.T) *config.Config {
	t.Helper()
	cfg := config.Default()
	cfg.Clerk = clerktest.NewEnv(t).Config()
	return cfg
}

func TestE2E_ClerkGetMe(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()

	dbPath := filepath.Join(t.TempDir(), "enx-e2e.db")
	sqlitex.Init(dbPath)
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}

	sub := "user_e2egetme001"
	email := "e2e-clerk@example.com"
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub)
	})
	sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub)

	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub":   sub,
		"email": email,
		"name":  "e2e-clerk-user",
	})

	ts, done := e2eServer(t, cfg)
	defer done()

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["email"] != email {
		t.Fatalf("email = %q, want %q", body["email"], email)
	}
	if body["name"] != "e2e-clerk-user" {
		t.Fatalf("name = %q, want e2e-clerk-user", body["name"])
	}
	if v, ok := body["isAdmin"].(bool); !ok || v {
		t.Fatalf("isAdmin = %v (%T), want false", body["isAdmin"], body["isAdmin"])
	}
}

func TestE2E_ClerkGetMe_IsAdminReflectsAllowlist(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()

	sub := "user_e2egetme_admin"
	cfg.Admin.ClerkUserIDs = []string{sub}

	dbPath := filepath.Join(t.TempDir(), "enx-e2e-admin.db")
	sqlitex.Init(dbPath)
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub) })

	token := env.SignSessionToken(t, jwt.MapClaims{"sub": sub, "email": "admin-me@example.com", "name": "admin-me"})

	ts, done := e2eServer(t, cfg)
	defer done()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if v, ok := body["isAdmin"].(bool); !ok || !v {
		t.Fatalf("isAdmin = %v, want true (sub is in the allowlist)", body["isAdmin"])
	}
}

// call sends one request with a bearer token and returns the status and body.
func call(t *testing.T, ts *httptest.Server, method, path, token, body string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out strings.Builder
	_, _ = io.Copy(&out, resp.Body)
	return resp.StatusCode, out.String()
}

// ADR-076 wiring: a signed-in user's page report reaches the admin's feedback
// list; the admin routes are admin-only, the daily limit comes from config,
// and the page-report routes it replaced are gone. The feedback rules
// themselves are in the feedback package.
func TestE2E_FeedbackRoutes(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()
	cfg.Feedback.DailyLimit = 1
	adminSub := "user_e2efeedback_admin"
	cfg.Admin.ClerkUserIDs = []string{adminSub}
	sqlitex.Init(filepath.Join(t.TempDir(), "enx-e2e-feedback.db"))

	user := env.SignSessionToken(t, jwt.MapClaims{"sub": "user_e2efeedback", "email": "user@example.com", "name": "user"})
	admin := env.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com", "name": "admin"})
	ts, done := e2eServer(t, cfg)
	defer done()

	report := func(url string) string {
		return `{"kind":"page_report","url":"` + url + `","context":{"adapter":"x","extVersion":"1.0.1"},"details":{"reason":"no-words"}}`
	}
	if status, body := call(t, ts, http.MethodPost, "/api/feedback", user, report("https://x.com/a?s=1")); status != http.StatusOK || body != `{"recorded":true,"success":true}` {
		t.Fatalf("submit: %d %s", status, body)
	}
	if status, body := call(t, ts, http.MethodPost, "/api/feedback", user, report("https://x.com/b")); status != http.StatusTooManyRequests ||
		!strings.Contains(body, `"code":"feedback_limit_exceeded"`) {
		t.Fatalf("second submit with a limit of 1: %d %s, want 429", status, body)
	}

	for _, req := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/feedback"},
		{http.MethodPatch, "/api/admin/feedback/x"},
		{http.MethodGet, "/api/admin/feedback/article-choices"},
		{http.MethodPost, "/api/admin/feedback/article-choices/resolve"},
	} {
		if status, _ := call(t, ts, req.method, req.path, user, `{"status":"resolved"}`); status != http.StatusForbidden {
			t.Errorf("%s %s as a user: status %d, want 403", req.method, req.path, status)
		}
	}

	status, body := call(t, ts, http.MethodGet, "/api/admin/feedback?kind=page_report", admin, "")
	var list struct {
		Feedback []struct{} `json:"feedback"`
	}
	if err := json.Unmarshal([]byte(body), &list); err != nil || status != http.StatusOK || len(list.Feedback) != 1 {
		t.Fatalf("admin list: %d %s, want the user's report", status, body)
	}

	for _, req := range []struct{ method, path string }{
		{http.MethodPost, "/api/page-reports"},
		{http.MethodGet, "/api/admin/page-reports"},
	} {
		if status, _ := call(t, ts, req.method, req.path, admin, report("https://x.com/c")); status != http.StatusNotFound {
			t.Errorf("%s %s: status %d, want 404 (removed by ADR-076)", req.method, req.path, status)
		}
	}
}

// ADR-041: a real QUERY request, with the paragraph in its JSON body, goes
// through the whole router -- CORS, Clerk auth, logging -- to paragraph-init.
func TestE2E_ParagraphInitOverQuery(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()
	sqlitex.Init(filepath.Join(t.TempDir(), "enx-query.db"))
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: "w-morning", English: "morning", CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	token := env.SignSessionToken(t, jwt.MapClaims{"sub": "user_e2equery001", "email": "e2e-query@example.com", "name": "e2e-query"})

	ts, done := e2eServer(t, cfg)
	defer done()

	for _, method := range []string{"QUERY", http.MethodPost} {
		req, err := http.NewRequest(method, ts.URL+"/api/paragraph-init", strings.NewReader(`{"paragraph":"Good morning."}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		var body struct {
			Data map[string]struct{ Id string }
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if err != nil || resp.StatusCode != http.StatusOK || body.Data["morning"].Id != "w-morning" {
			t.Fatalf("%s: status %d, err %v, body %+v; want 200 with morning -> w-morning", method, resp.StatusCode, err, body)
		}
	}
}

// ADR-040 wiring: a real lookup through the full router lands in the lookup
// histogram under the source that answered -- ECDICT first, then the words
// cache -- and in the HTTP counters under its route template.
func TestE2E_LookupMetrics(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()
	sqlitex.Init(filepath.Join(t.TempDir(), "enx-metrics.db"))
	seedEcdict(t)
	token := env.SignSessionToken(t, jwt.MapClaims{"sub": "user_e2emetrics001", "email": "e2e-metrics@example.com", "name": "e2e-metrics"})

	gin.SetMode(gin.TestMode)
	m := metrics.New()
	ts := httptest.NewServer(setupRouter(cfg, m))
	defer ts.Close()

	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/word/hello", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("lookup %d: status %d", i+1, resp.StatusCode)
		}
	}

	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	out := w.Body.String()
	for _, want := range []string{
		`enx_dictionary_lookup_duration_seconds_count{source="ecdict"} 1`,
		`enx_dictionary_lookup_duration_seconds_count{source="local"} 1`,
		`enx_http_requests_total{method="GET",route="/api/word/:word",status="200"} 2`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("/metrics lacks %q", want)
		}
	}
	if strings.Contains(out, "hello") {
		t.Error("/metrics contains the looked-up word")
	}
}

// ADR-069: a new user's review list is an empty array; the route is in the
// per-user rate limit, and a successful load counts under its route label.
func TestE2E_ReviewWordsRoute(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()
	cfg.RateLimit = config.RateLimit{RequestsPerSecond: 0.01, Burst: 1}
	sqlitex.Init(filepath.Join(t.TempDir(), "enx-e2e-review-words.db"))
	token := env.SignSessionToken(t, jwt.MapClaims{"sub": "user_e2ereviewwords", "email": "review@example.com", "name": "review"})

	gin.SetMode(gin.TestMode)
	m := metrics.New()
	ts := httptest.NewServer(setupRouter(cfg, m))
	defer ts.Close()

	get := func() (int, string) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me/review-words", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		var body strings.Builder
		_, _ = io.Copy(&body, resp.Body)
		return resp.StatusCode, body.String()
	}

	if status, body := get(); status != http.StatusOK || body != "[]" {
		t.Fatalf("first request: %d %s, want 200 []", status, body)
	}
	if status, _ := get(); status != http.StatusTooManyRequests {
		t.Fatalf("second request: status %d, want 429 from the rate limit", status)
	}

	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	want := `enx_http_requests_total{method="GET",route="/api/me/review-words",status="200"} 1`
	if !strings.Contains(w.Body.String(), want) {
		t.Errorf("/metrics lacks %q", want)
	}
}

// ADR-060 Decision 2: the request rate limit sits on the signed-in /api
// routes, after clerkAuth; unauthenticated routes are not in it.
func TestE2E_SignedInRequestsAreRateLimitedPerUser(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()
	cfg.RateLimit = config.RateLimit{RequestsPerSecond: 0.01, Burst: 2}

	sqlitex.Init(filepath.Join(t.TempDir(), "enx-e2e-ratelimit.db"))
	sub := "user_e2eratelimit"
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub) })
	token := env.SignSessionToken(t, jwt.MapClaims{"sub": sub, "email": "rate@example.com", "name": "rate"})

	ts, done := e2eServer(t, cfg)
	defer done()

	do := func(path, bearer string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		_ = resp.Body.Close()
		return resp
	}

	// Unauthenticated routes and 401s never touch the bucket.
	for i := 0; i < 5; i++ {
		if resp := do("/ping", ""); resp.StatusCode != http.StatusOK {
			t.Fatalf("/ping %d: status %d, want 200", i, resp.StatusCode)
		}
		if resp := do("/api/me", ""); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("unsigned /api/me %d: status %d, want 401", i, resp.StatusCode)
		}
	}

	for i := 0; i < 2; i++ {
		if resp := do("/api/me", token); resp.StatusCode != http.StatusOK {
			t.Fatalf("signed-in request %d: status %d, want 200", i+1, resp.StatusCode)
		}
	}
	resp := do("/api/me", token)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("third signed-in request: status %d, want 429", resp.StatusCode)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Fatal("429 without Retry-After")
	}
}
