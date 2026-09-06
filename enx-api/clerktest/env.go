// Package clerktest provides a local JWKS server and signed Clerk-like session
// tokens for middleware and e2e tests (ADR-015).
package clerktest

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

// Env holds a running JWKS server plus the config a Clerk validator needs.
type Env struct {
	Issuer            string
	JWKSURL           string
	AuthorizedParty   string
	AuthorizedParties []string
	key               *rsa.PrivateKey
	kid               string
}

// NewEnv starts an httptest JWKS server and returns Clerk test configuration.
func NewEnv(t *testing.T) *Env {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	kid := "test-kid"
	jwks := map[string]any{
		"keys": []map[string]string{{
			"kty": "RSA",
			"kid": kid,
			"use": "sig",
			"alg": "RS256",
			"n":   base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes()),
		}},
	}
	body, err := json.Marshal(jwks)
	if err != nil {
		t.Fatalf("marshal jwks: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	azp := "https://enx.wiloon.lab"
	return &Env{
		Issuer:            "https://enx.clerk.accounts.dev",
		JWKSURL:           srv.URL,
		AuthorizedParty:   azp,
		AuthorizedParties: []string{azp, "chrome-extension://enxextensionid"},
		key:               key,
		kid:               kid,
	}
}

// ApplyViper configures viper so setupRouter() uses this test Clerk environment.
func (env *Env) ApplyViper() {
	viper.Set("clerk.issuer", env.Issuer)
	viper.Set("clerk.authorized-parties", env.AuthorizedParties)
	viper.Set("clerk.jwks-url", env.JWKSURL)
}

// SignSessionToken returns a signed RS256 Clerk-like session token. Missing
// standard claims (iss, azp, exp, nbf, iat) are filled with valid defaults.
func (env *Env) SignSessionToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()

	now := time.Now()
	if _, ok := claims["iss"]; !ok {
		claims["iss"] = env.Issuer
	}
	if _, ok := claims["azp"]; !ok {
		claims["azp"] = env.AuthorizedParty
	}
	if _, ok := claims["iat"]; !ok {
		claims["iat"] = now.Unix()
	}
	if _, ok := claims["nbf"]; !ok {
		claims["nbf"] = now.Add(-time.Minute).Unix()
	}
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = now.Add(time.Hour).Unix()
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = env.kid

	signed, err := token.SignedString(env.key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}
