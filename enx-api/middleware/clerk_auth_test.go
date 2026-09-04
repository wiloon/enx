package middleware

import (
	"enx-api/clerktest"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func testClerkEnv(t *testing.T) (*clerktest.Env, ClerkConfig) {
	t.Helper()
	env := clerktest.NewEnv(t)
	return env, ClerkConfig{
		Issuer:            env.Issuer,
		AuthorizedParties: env.AuthorizedParties,
		JWKSURL:           env.JWKSURL,
	}
}

func runClerkAuth(t *testing.T, cfg ClerkConfig, authHeader string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	handler := ClerkAuth(cfg)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	c.Request = req
	handler(c)
	return w
}

func TestClerkConfigValid(t *testing.T) {
	tests := []struct {
		name string
		cfg  ClerkConfig
		want bool
	}{
		{
			name: "complete",
			cfg:  ClerkConfig{Issuer: "https://enx.clerk.accounts.dev", AuthorizedParties: []string{"https://enx.wiloon.lab"}},
			want: true,
		},
		{
			name: "missing issuer",
			cfg:  ClerkConfig{AuthorizedParties: []string{"https://enx.wiloon.lab"}},
			want: false,
		},
		{
			name: "missing authorized parties",
			cfg:  ClerkConfig{Issuer: "https://enx.clerk.accounts.dev"},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.valid(); got != tt.want {
				t.Fatalf("valid() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestClerkConfigJWKSURL(t *testing.T) {
	cfg := ClerkConfig{Issuer: "https://enx.clerk.accounts.dev"}
	if got := cfg.jwksURL(); got != "https://enx.clerk.accounts.dev/.well-known/jwks.json" {
		t.Fatalf("jwksURL() = %q", got)
	}

	cfg.JWKSURL = "http://localhost/jwks.json"
	if got := cfg.jwksURL(); got != "http://localhost/jwks.json" {
		t.Fatalf("jwksURL override = %q", got)
	}
}

func TestClerkAuth_IncompleteConfig(t *testing.T) {
	w := runClerkAuth(t, ClerkConfig{}, "")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestClerkAuth_MissingAuthorizationHeader(t *testing.T) {
	_, cfg := testClerkEnv(t)
	if w := runClerkAuth(t, cfg, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_MalformedToken(t *testing.T) {
	_, cfg := testClerkEnv(t)
	if w := runClerkAuth(t, cfg, "Bearer not-a-jwt"); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_ExpiredToken(t *testing.T) {
	env, cfg := testClerkEnv(t)
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": "user_expired",
		"exp": time.Now().Add(-time.Hour).Unix(),
	})
	if w := runClerkAuth(t, cfg, "Bearer "+token); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_NotYetValidToken(t *testing.T) {
	env, cfg := testClerkEnv(t)
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": "user_future",
		"nbf": time.Now().Add(time.Hour).Unix(),
	})
	if w := runClerkAuth(t, cfg, "Bearer "+token); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_WrongIssuer(t *testing.T) {
	env, cfg := testClerkEnv(t)
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": "user_wrongiss",
		"iss": "https://evil.clerk.accounts.dev",
	})
	if w := runClerkAuth(t, cfg, "Bearer "+token); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_UnauthorizedParty(t *testing.T) {
	env, cfg := testClerkEnv(t)
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": "user_wrongazp",
		"azp": "https://not-my-origin.example",
	})
	if w := runClerkAuth(t, cfg, "Bearer "+token); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_AuthorizedPartyValidatedOnlyWhenPresent(t *testing.T) {
	v := &clerkValidator{cfg: ClerkConfig{AuthorizedParties: []string{"https://enx.wiloon.lab"}}}

	if !v.authorizedPartyAllowed(jwt.MapClaims{}) {
		t.Error("absent azp should be allowed (Clerk manual-verification pattern)")
	}
	if !v.authorizedPartyAllowed(jwt.MapClaims{"azp": "https://enx.wiloon.lab"}) {
		t.Error("known azp should be allowed")
	}
	if v.authorizedPartyAllowed(jwt.MapClaims{"azp": "https://evil.example"}) {
		t.Error("unknown azp should be rejected")
	}
}

func TestClerkAuth_MissingSubject(t *testing.T) {
	env, cfg := testClerkEnv(t)
	token := env.SignSessionToken(t, jwt.MapClaims{})
	if w := runClerkAuth(t, cfg, "Bearer "+token); w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestClerkAuth_OPTIONSAllowed(t *testing.T) {
	_, cfg := testClerkEnv(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(ClerkAuth(cfg))
	called := false
	r.OPTIONS("/api/me", func(c *gin.Context) {
		called = true
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/me", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if !called {
		t.Fatal("expected OPTIONS handler to run")
	}
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}
