package main

import (
	"encoding/json"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils"
	"enx-api/utils/sqlitex"
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
	utils.ViperInit()
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

// TestE2E_UnauthenticatedAccessRejected verifies that protected endpoints
// return 401 when no Bearer token is provided.
func TestE2E_UnauthenticatedAccessRejected(t *testing.T) {
	ts, done := e2eServer(t, clerkConfig(t))
	defer done()

	client := ts.Client()

	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/paragraph-init"},
		{http.MethodGet, "/api/admin/page-reports"},
	}

	for _, ep := range endpoints {
		req, _ := http.NewRequest(ep.method, ts.URL+ep.path, nil)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s request failed: %v", ep.method, ep.path, err)
		}
		resp.Body.Close()

		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", ep.method, ep.path, resp.StatusCode)
		}
	}
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
	defer resp.Body.Close()

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
	defer resp.Body.Close()

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if v, ok := body["isAdmin"].(bool); !ok || !v {
		t.Fatalf("isAdmin = %v, want true (sub is in the allowlist)", body["isAdmin"])
	}
}

func TestE2E_AdminPageReportsRequiresAdmin(t *testing.T) {
	env := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = env.Config()

	dbPath := filepath.Join(t.TempDir(), "enx-e2e-page-reports.db")
	sqlitex.Init(dbPath)

	sub := "user_e2epage_reports"
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub) })
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": sub, "email": "user@example.com", "name": "not-admin",
	})

	ts, done := e2eServer(t, cfg)
	defer done()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/admin/page-reports", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("GET /api/admin/page-reports: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for non-admin", resp.StatusCode)
	}

	// The same user on a server that lists them as admin.
	adminCfg := *cfg
	adminCfg.Admin.ClerkUserIDs = []string{sub}
	adminTS, adminDone := e2eServer(t, &adminCfg)
	defer adminDone()

	adminToken := env.SignSessionToken(t, jwt.MapClaims{
		"sub": sub, "email": "admin@example.com", "name": "admin",
	})
	req2, _ := http.NewRequest(http.MethodGet, adminTS.URL+"/api/admin/page-reports", nil)
	req2.Header.Set("Authorization", "Bearer "+adminToken)
	resp2, err := adminTS.Client().Do(req2)
	if err != nil {
		t.Fatalf("GET /api/admin/page-reports as admin: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 for admin", resp2.StatusCode)
	}
	var body struct {
		Success bool             `json:"success"`
		Reports []map[string]any `json:"reports"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&body); err != nil || !body.Success {
		t.Fatalf("body=%+v err=%v", body, err)
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
		resp.Body.Close()
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
		resp.Body.Close()
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
