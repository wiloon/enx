//go:build integration

package middleware

import (
	"enx-api/clerktest"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func initClerkIntegrationDB(t *testing.T) {
	t.Helper()
	logger.Init("CONSOLE", "debug", "enx-api-test")
	dbPath := filepath.Join(t.TempDir(), "enx-test.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}
}

func clerkTestConfig(env *clerktest.Env) ClerkConfig {
	return ClerkConfig{
		Issuer:            env.Issuer,
		AuthorizedParties: env.AuthorizedParties,
		JWKSURL:           env.JWKSURL,
	}
}

func TestClerkAuth_ValidTokenProvisionsUser(t *testing.T) {
	initClerkIntegrationDB(t)
	env := clerktest.NewEnv(t)

	sub := "user_integrationclerk001"
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub)
	})
	sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub)

	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub":   sub,
		"email": "clerk-mw@example.com",
		"name":  "Clerk MW",
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(ClerkAuth(clerkTestConfig(env)))
	r.GET("/api/me", func(c *gin.Context) {
		if got, _ := c.Get("clerk_user_id"); got != sub {
			t.Fatalf("clerk_user_id = %v, want %s", got, sub)
		}
		if _, ok := c.Get("user_id"); !ok {
			t.Fatal("expected user_id in context")
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
}

// A token a few seconds past exp by our clock must still be accepted:
// clerk-js's ~60s-TTL refresh timer is frozen while the extension's MV3
// service worker is suspended, and homelab pods have loose clock sync.
// clerkClockLeeway (60s) covers that.
func TestClerkAuth_ExpiredWithinLeewayAccepted(t *testing.T) {
	initClerkIntegrationDB(t)
	env := clerktest.NewEnv(t)

	sub := "user_integrationclerk_leeway"
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub)
	})
	sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id = ?", sub)

	now := time.Now()
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub":   sub,
		"email": "clerk-leeway@example.com",
		"iat":   now.Add(-90 * time.Second).Unix(),
		"exp":   now.Add(-30 * time.Second).Unix(),
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(ClerkAuth(clerkTestConfig(env)))
	r.GET("/api/me", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (token 30s past exp is within leeway), body: %s", w.Code, w.Body.String())
	}
}
