//go:build integration

package main

import (
	"encoding/json"
	"enx-api/cognitotest"
	"enx-api/utils"
	"enx-api/utils/sqlitex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func initCognitoE2EDB(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "enx-e2e.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}
}

func TestIntegration_CognitoGetMe(t *testing.T) {
	env := cognitotest.NewEnv(t)
	utils.ViperInit()
	env.ApplyViper()
	initCognitoE2EDB(t)

	sub := "integration-e2e-getme-sub"
	email := "e2e-getme@example.com"
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE cognito_sub = ?", sub)
	})
	sqlitex.DB.Exec("DELETE FROM users WHERE cognito_sub = ?", sub)

	token := env.SignAccessToken(t, jwt.MapClaims{
		"sub":              sub,
		"email":            email,
		"cognito:username": "e2e-user",
	})

	gin.SetMode(gin.TestMode)
	ts := httptest.NewServer(setupRouter())
	defer ts.Close()

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["email"] != email {
		t.Fatalf("email = %q, want %q", body["email"], email)
	}
	if body["name"] != "e2e-user" {
		t.Fatalf("name = %q, want e2e-user", body["name"])
	}
	if body["status"] != "active" {
		t.Fatalf("status = %q, want active", body["status"])
	}
}
