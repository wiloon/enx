package cognitotest

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

// Env provides a local JWKS server and signed Cognito-like JWTs for tests.
type Env struct {
	Region     string
	UserPoolID string
	JWKSURL    string
	ClientID   string
	ClientIDs  []string
	Issuer     string
	key        *rsa.PrivateKey
	kid        string
}

// NewEnv starts an httptest JWKS server and returns Cognito test configuration.
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

	region := "us-east-1"
	poolID := "test_pool"
	clientID := "ui-client-id"

	return &Env{
		Region:     region,
		UserPoolID: poolID,
		JWKSURL:    srv.URL,
		ClientID:   clientID,
		ClientIDs:  []string{clientID, "chrome-client-id"},
		Issuer:     "https://cognito-idp." + region + ".amazonaws.com/" + poolID,
		key:        key,
		kid:        kid,
	}
}

// ApplyViper configures viper so setupRouter() uses this test Cognito environment.
func (env *Env) ApplyViper() {
	viper.Set("cognito.region", env.Region)
	viper.Set("cognito.user-pool-id", env.UserPoolID)
	viper.Set("cognito.client-id", env.ClientID)
	viper.Set("cognito.chrome-client-id", "chrome-client-id")
	viper.Set("cognito.jwks-url", env.JWKSURL)
}

// SignAccessToken returns a signed RS256 access token for middleware tests.
func (env *Env) SignAccessToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()

	if _, ok := claims["iss"]; !ok {
		claims["iss"] = env.Issuer
	}
	if _, ok := claims["token_use"]; !ok {
		claims["token_use"] = "access"
	}
	if _, ok := claims["client_id"]; !ok {
		claims["client_id"] = env.ClientID
	}
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = time.Now().Add(time.Hour).Unix()
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = env.kid

	signed, err := token.SignedString(env.key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}
