package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/ecdict"
	"enx-api/ecdict/ecdicttest"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
)

const (
	adminSub    = "user_admin_dict_e2e"
	nonAdminSub = "user_plain_dict_e2e"
)

// adminDictEnv wires a full test server with Clerk, a fresh app DB, an ECDICT
// database seeded with a couple of rows, and adminSub in the admin allowlist.
func adminDictEnv(t *testing.T) (baseURL string, adminToken, plainToken string) {
	t.Helper()
	return adminDictEnvWithConfig(t, noTrialConfig())
}

// noTrialConfig is the default config without the sign-up trial (ADR-048):
// most of these tests rely on a new user having no credit. Tests of the trial
// turn it back on.
func noTrialConfig() *config.Config {
	cfg := config.Default()
	cfg.Credits.Trial.Amount = 0
	return cfg
}

// adminDictEnvWithConfig is adminDictEnv on the given config.
func adminDictEnvWithConfig(t *testing.T, cfg *config.Config) (baseURL string, adminToken, plainToken string) {
	t.Helper()
	return adminDictEnvServed(t, cfg, e2eServer)
}

// adminDictEnvServed is adminDictEnvWithConfig with the server started by
// serve, for tests that wire the router differently (e.g. a fake Stripe).
func adminDictEnvServed(t *testing.T, cfg *config.Config, serve func(*testing.T, *config.Config) (*httptest.Server, func())) (baseURL string, adminToken, plainToken string) {
	t.Helper()

	env := clerktest.NewEnv(t)
	cfg.Clerk = env.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}

	dbPath := filepath.Join(t.TempDir(), "enx-admin-dict.db")
	sqlitex.Init(dbPath)
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id IN (?, ?)", adminSub, nonAdminSub)
		sqlitex.DB.Exec("DELETE FROM words WHERE english IN (?, ?, ?)", "hello", "running", "serendipity")
	})

	seedEcdict(t)

	ts, done := serve(t, cfg)
	t.Cleanup(done)

	adminToken = env.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com", "name": "admin"})
	plainToken = env.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": "plain@example.com", "name": "plain"})
	return ts.URL, adminToken, plainToken
}

func seedEcdict(t *testing.T) {
	t.Helper()
	ecdict.Init(ecdicttest.Create(t,
		ecdicttest.Row{Word: "hello", Sw: "hello", Phonetic: "/həˈloʊ/", Translation: "int. 你好；喂"},
		ecdicttest.Row{Word: "run", Sw: "run", Phonetic: "/rʌn/", Translation: "v. 跑；奔跑\nn. 奔跑", Exchange: "i:running/d:ran"},
	))
	if !ecdict.IsAvailable() {
		t.Fatal("ECDICT not available after Init")
	}
	t.Cleanup(func() { ecdict.Init("") })
}

func doJSON(t *testing.T, method, url, token string) (int, map[string]any) {
	t.Helper()
	return doJSONBody(t, method, url, token, nil)
}

// doJSONBody is doJSON with a JSON request body (nil sends none).
func doJSONBody(t *testing.T, method, url, token string, payload any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("encode body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body
}

func TestE2E_AdminDictionary_RequiresAdmin(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)

	endpoints := []struct{ method, path string }{
		{http.MethodGet, "/api/admin/words/hello"},
		{http.MethodGet, "/api/admin/ecdict/hello"},
		{http.MethodPost, "/api/admin/words/hello/sync-from-ecdict"},
		{http.MethodPut, "/api/admin/words/hello"},
		{http.MethodGet, "/api/admin/ai-words"},
		{http.MethodDelete, "/api/admin/words/hello"},
	}
	for _, ep := range endpoints {
		if code, _ := doJSON(t, ep.method, base+ep.path, plainToken); code != http.StatusForbidden {
			t.Errorf("%s %s as non-admin: status = %d, want 403", ep.method, ep.path, code)
		}
		if code, _ := doJSON(t, ep.method, base+ep.path, ""); code != http.StatusUnauthorized {
			t.Errorf("%s %s unauthenticated: status = %d, want 401", ep.method, ep.path, code)
		}
	}
	// Admin passes the gate (200 for the reads).
	if code, _ := doJSON(t, http.MethodGet, base+"/api/admin/ecdict/hello", adminToken); code != http.StatusOK {
		t.Errorf("admin GET ecdict: status = %d, want 200", code)
	}
}
