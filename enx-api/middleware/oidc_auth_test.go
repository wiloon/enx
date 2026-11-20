package middleware

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const oidcTestIssuer = "https://logto.example/oidc"

// es384Issuer is a JWKS server publishing one ES384 key, standing in for the
// Logto deployment of ADR-036.
type es384Issuer struct {
	key     *ecdsa.PrivateKey
	jwksURL string
}

func newES384Issuer(t *testing.T) *es384Issuer {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	body, err := json.Marshal(map[string]any{"keys": []map[string]string{{
		"kty": "EC", "crv": "P-384", "kid": "es-kid", "use": "sig", "alg": "ES384",
		"x": enc(key.X.FillBytes(make([]byte, 48))),
		"y": enc(key.Y.FillBytes(make([]byte, 48))),
	}}})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return &es384Issuer{key: key, jwksURL: srv.URL}
}

func (i *es384Issuer) sign(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	now := time.Now()
	claims["iss"] = oidcTestIssuer
	claims["iat"] = now.Unix()
	claims["exp"] = now.Add(time.Hour).Unix()
	tok := jwt.NewWithClaims(jwt.SigningMethodES384, claims)
	tok.Header["kid"] = "es-kid"
	s, err := tok.SignedString(i.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func (i *es384Issuer) config() ClerkConfig {
	return ClerkConfig{
		Issuer:                   oidcTestIssuer,
		JWKSURL:                  i.jwksURL,
		AuthorizedParties:        []string{"logto-app"},
		AllowedSigningAlgorithms: []string{"ES384"},
	}
}

// protectedStatus sends token through the middleware in front of a protected
// route and returns the status the client sees.
func protectedStatus(t *testing.T, cfg ClerkConfig, token string) (int, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(ClerkAuth(cfg, nil))
	r.GET("/api/me", func(c *gin.Context) {
		sub, _ := c.Get("clerk_user_id")
		c.JSON(http.StatusOK, gin.H{"sub": sub})
	})
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code, w
}

func TestOIDCAuth_ES384TokenNeedsES384Configured(t *testing.T) {
	newUsersDB(t)
	iss := newES384Issuer(t)
	token := iss.sign(t, jwt.MapClaims{"sub": "logto_1", "email": "a@example.com"})

	if code, w := protectedStatus(t, iss.config(), token); code != http.StatusOK {
		t.Fatalf("ES384 configured: status %d body %s, want 200", code, w.Body.String())
	}

	rsOnly := iss.config()
	rsOnly.AllowedSigningAlgorithms = nil // the default: RS256
	if code, _ := protectedStatus(t, rsOnly, token); code != http.StatusUnauthorized {
		t.Fatalf("RS256 only: status %d, want 401", code)
	}
}

func TestOIDCAuth_RemappedClaimsReachTheRouteAndTheStoredProfile(t *testing.T) {
	newUsersDB(t)
	iss := newES384Issuer(t)
	cfg := iss.config()
	cfg.SubjectClaim = "uid"
	cfg.EmailClaim = "mail"
	cfg.NameClaim = "display"
	cfg.ImageURLClaim = "pic"
	token := iss.sign(t, jwt.MapClaims{
		"sub": "ignored", "uid": "logto_2", "mail": "b@example.com", "display": "Bee", "pic": "https://img.example/b.png",
	})

	code, w := protectedStatus(t, cfg, token)
	if code != http.StatusOK {
		t.Fatalf("status %d body %s, want 200", code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["sub"] != "logto_2" {
		t.Errorf("route subject = %v, want logto_2", body["sub"])
	}
	var u sqlitex.User
	if err := sqlitex.DB.First(&u, "clerk_user_id = ?", "logto_2").Error; err != nil {
		t.Fatalf("stored user: %v", err)
	}
	if u.Email != "b@example.com" || u.Name != "Bee" || u.AvatarUrl != "https://img.example/b.png" {
		t.Errorf("stored profile %+v", u)
	}
}

func TestOIDCAuth_MissingSubjectClaimIsRefused(t *testing.T) {
	newUsersDB(t)
	iss := newES384Issuer(t)
	cfg := iss.config()
	cfg.SubjectClaim = "uid"
	token := iss.sign(t, jwt.MapClaims{"sub": "only-sub", "email": "c@example.com"})
	if code, _ := protectedStatus(t, cfg, token); code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", code)
	}
}

func TestOIDCAuth_ConfiguredAudienceMustMatch(t *testing.T) {
	newUsersDB(t)
	iss := newES384Issuer(t)
	cfg := iss.config()
	cfg.Audience = "https://api.enx.example"

	for name, tc := range map[string]struct {
		aud  any
		want int
	}{
		"matching":      {"https://api.enx.example", http.StatusOK},
		"among several": {[]string{"other", "https://api.enx.example"}, http.StatusOK},
		"other":         {"https://elsewhere.example", http.StatusUnauthorized},
		"absent":        {nil, http.StatusUnauthorized},
	} {
		t.Run(name, func(t *testing.T) {
			claims := jwt.MapClaims{"sub": "aud_" + name, "email": "d@example.com"}
			if tc.aud != nil {
				claims["aud"] = tc.aud
			}
			if code, _ := protectedStatus(t, cfg, iss.sign(t, claims)); code != tc.want {
				t.Errorf("status %d, want %d", code, tc.want)
			}
		})
	}

	// No configured audience: the check is skipped, as for Clerk.
	if code, _ := protectedStatus(t, iss.config(), iss.sign(t, jwt.MapClaims{"sub": "aud_free", "email": "e@example.com", "aud": "anything"})); code != http.StatusOK {
		t.Errorf("no audience configured: status %d, want 200", code)
	}
}

func TestOIDCAuth_PartyClaimRejectsUnlistedValueAndAllowsAbsent(t *testing.T) {
	newUsersDB(t)
	iss := newES384Issuer(t)
	cfg := iss.config()
	cfg.AuthorizedPartyClaim = "client_id"

	for name, tc := range map[string]struct {
		claim any
		want  int
	}{
		"listed":     {"logto-app", http.StatusOK},
		"unlisted":   {"someone-else", http.StatusUnauthorized},
		"absent":     {nil, http.StatusOK},
		"empty":      {"", http.StatusOK},
		"non-string": {42, http.StatusOK},
	} {
		t.Run(name, func(t *testing.T) {
			claims := jwt.MapClaims{"sub": "party_" + name, "email": "f@example.com", "azp": "ignored-by-config"}
			if tc.claim != nil {
				claims["client_id"] = tc.claim
			}
			if code, _ := protectedStatus(t, cfg, iss.sign(t, claims)); code != tc.want {
				t.Errorf("status %d, want %d", code, tc.want)
			}
		})
	}
}
