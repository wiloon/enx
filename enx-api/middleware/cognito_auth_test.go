package middleware

import (
	"enx-api/cognitotest"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func testEnv(t *testing.T) (*cognitotest.Env, CognitoConfig) {
	t.Helper()
	env := cognitotest.NewEnv(t)
	return env, CognitoConfig{
		Region:     env.Region,
		UserPoolID: env.UserPoolID,
		ClientIDs:  env.ClientIDs,
		JWKSURL:    env.JWKSURL,
	}
}

func TestCognitoConfigValid(t *testing.T) {
	tests := []struct {
		name string
		cfg  CognitoConfig
		want bool
	}{
		{
			name: "complete",
			cfg: CognitoConfig{
				Region: "us-east-1", UserPoolID: "pool", ClientIDs: []string{"client"},
			},
			want: true,
		},
		{
			name: "missing region",
			cfg:  CognitoConfig{UserPoolID: "pool", ClientIDs: []string{"client"}},
			want: false,
		},
		{
			name: "missing pool",
			cfg:  CognitoConfig{Region: "us-east-1", ClientIDs: []string{"client"}},
			want: false,
		},
		{
			name: "missing clients",
			cfg:  CognitoConfig{Region: "us-east-1", UserPoolID: "pool"},
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

func TestCognitoConfigIssuerAndJWKS(t *testing.T) {
	cfg := CognitoConfig{Region: "us-east-1", UserPoolID: "pool_abc"}
	if got := cfg.issuer(); got != "https://cognito-idp.us-east-1.amazonaws.com/pool_abc" {
		t.Fatalf("issuer() = %q", got)
	}
	if got := cfg.jwksURL(); got != cfg.issuer()+"/.well-known/jwks.json" {
		t.Fatalf("jwksURL() = %q", got)
	}

	cfg.JWKSURL = "http://localhost/jwks.json"
	if got := cfg.jwksURL(); got != "http://localhost/jwks.json" {
		t.Fatalf("jwksURL override = %q", got)
	}
}

func TestClaimAudience(t *testing.T) {
	tests := []struct {
		name   string
		claims jwt.MapClaims
		want   string
	}{
		{"string aud", jwt.MapClaims{"aud": "client-a"}, "client-a"},
		{"array aud", jwt.MapClaims{"aud": []any{"client-b"}}, "client-b"},
		{"missing aud", jwt.MapClaims{}, ""},
		{"empty array aud", jwt.MapClaims{"aud": []any{}}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := claimAudience(tt.claims); got != tt.want {
				t.Fatalf("claimAudience() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestContains(t *testing.T) {
	list := []string{"a", "b", "c"}
	if !contains(list, "b") {
		t.Fatal("expected contains b")
	}
	if contains(list, "z") {
		t.Fatal("expected not contains z")
	}
}

func TestAudienceAllowed(t *testing.T) {
	v := &cognitoValidator{cfg: CognitoConfig{ClientIDs: []string{"ui-client", "chrome-client"}}}

	tests := []struct {
		name   string
		claims jwt.MapClaims
		want   bool
	}{
		{
			name:   "access token matching client_id",
			claims: jwt.MapClaims{"token_use": "access", "client_id": "ui-client"},
			want:   true,
		},
		{
			name:   "access token wrong client_id",
			claims: jwt.MapClaims{"token_use": "access", "client_id": "other"},
			want:   false,
		},
		{
			name:   "id token matching aud",
			claims: jwt.MapClaims{"token_use": "id", "aud": "chrome-client"},
			want:   true,
		},
		{
			name:   "fallback client_id",
			claims: jwt.MapClaims{"client_id": "ui-client"},
			want:   true,
		},
		{
			name:   "fallback aud",
			claims: jwt.MapClaims{"aud": "chrome-client"},
			want:   true,
		},
		{
			name:   "no match",
			claims: jwt.MapClaims{"token_use": "access", "client_id": "unknown"},
			want:   false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := v.audienceAllowed(tt.claims); got != tt.want {
				t.Fatalf("audienceAllowed() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCognitoAuth_IncompleteConfig(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := CognitoAuth(CognitoConfig{})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	handler(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestCognitoAuth_MissingAuthorizationHeader(t *testing.T) {
	_, cfg := testEnv(t)
	handler := CognitoAuth(cfg)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	handler(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestCognitoAuth_OPTIONSAllowed(t *testing.T) {
	_, cfg := testEnv(t)
	handler := CognitoAuth(cfg)
	called := false

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(handler)
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

func TestCognitoAuth_InvalidToken(t *testing.T) {
	_, cfg := testEnv(t)
	handler := CognitoAuth(cfg)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	c.Request = req
	handler(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestCognitoAuth_ExpiredToken(t *testing.T) {
	env, cfg := testEnv(t)
	token := env.SignAccessToken(t, jwt.MapClaims{
		"sub":       "user-1",
		"exp":       time.Now().Add(-time.Hour).Unix(),
		"client_id": env.ClientID,
	})
	handler := CognitoAuth(cfg)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	c.Request = req
	handler(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestCognitoAuth_WrongClientID(t *testing.T) {
	env, cfg := testEnv(t)
	token := env.SignAccessToken(t, jwt.MapClaims{
		"sub":       "user-1",
		"client_id": "wrong-client",
	})
	handler := CognitoAuth(cfg)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	c.Request = req
	handler(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}
