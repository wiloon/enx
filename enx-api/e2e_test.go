package main

import (
	"encoding/json"
	"enx-api/clerktest"
	"enx-api/utils"
	"enx-api/utils/sqlitex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

// e2eServer creates a real httptest.Server backed by the full application router.
// The returned cleanup function must be called when the test is done.
func e2eServer(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	utils.ViperInit()
	gin.SetMode(gin.TestMode)
	router := setupRouter()
	ts := httptest.NewServer(router)
	return ts, func() { ts.Close() }
}

// TestE2E_UnauthenticatedAccessRejected verifies that protected endpoints
// return 401 when no Bearer token is provided.
func TestE2E_UnauthenticatedAccessRejected(t *testing.T) {
	ts, done := e2eServer(t)
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
	utils.ViperInit()
	env.ApplyViper()

	dbPath := filepath.Join(t.TempDir(), "enx-e2e.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
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

	ts, done := e2eServer(t)
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
	utils.ViperInit()
	env.ApplyViper()

	sub := "user_e2egetme_admin"
	viper.Set("admin.clerk-user-ids", []string{sub})
	t.Cleanup(func() { viper.Set("admin.clerk-user-ids", nil) })

	dbPath := filepath.Join(t.TempDir(), "enx-e2e-admin.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub) })

	token := env.SignSessionToken(t, jwt.MapClaims{"sub": sub, "email": "admin-me@example.com", "name": "admin-me"})

	ts, done := e2eServer(t)
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
	utils.ViperInit()
	env.ApplyViper()

	dbPath := filepath.Join(t.TempDir(), "enx-e2e-page-reports.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()

	sub := "user_e2epage_reports"
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub) })
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": sub, "email": "user@example.com", "name": "not-admin",
	})

	ts, done := e2eServer(t)
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

	viper.Set("admin.clerk-user-ids", []string{sub})
	t.Cleanup(func() { viper.Set("admin.clerk-user-ids", nil) })

	adminToken := env.SignSessionToken(t, jwt.MapClaims{
		"sub": sub, "email": "admin@example.com", "name": "admin",
	})
	req2, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/admin/page-reports", nil)
	req2.Header.Set("Authorization", "Bearer "+adminToken)
	resp2, err := ts.Client().Do(req2)
	if err != nil {
		t.Fatalf("GET /api/admin/page-reports as admin: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 for admin", resp2.StatusCode)
	}
	var body struct {
		Success bool            `json:"success"`
		Reports []map[string]any `json:"reports"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&body); err != nil || !body.Success {
		t.Fatalf("body=%+v err=%v", body, err)
	}
}
