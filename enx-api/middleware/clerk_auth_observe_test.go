package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type recordedAuth struct{ outcomes []string }

func (r *recordedAuth) ObserveAuth(outcome string, elapsed time.Duration) {
	if elapsed < 0 {
		panic("negative elapsed")
	}
	r.outcomes = append(r.outcomes, outcome)
}

func observeClerkAuth(cfg ClerkConfig, authHeader string, obs AuthObserver) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	if authHeader != "" {
		c.Request.Header.Set("Authorization", authHeader)
	}
	ClerkAuth(cfg, obs)(c)
}

// ADR-040: every token check reports how it ended, so "session expired"
// reports from users can be matched to real verification failures.
func TestClerkAuthReportsOutcome(t *testing.T) {
	env, cfg := testClerkEnv(t)
	expired := env.SignSessionToken(t, jwt.MapClaims{"sub": "u", "exp": time.Now().Add(-time.Hour).Unix()})
	foreignParty := env.SignSessionToken(t, jwt.MapClaims{"sub": "u", "azp": "https://evil.example"})
	noSubject := env.SignSessionToken(t, jwt.MapClaims{})

	for _, tc := range []struct {
		name, header, want string
	}{
		{"no header", "", "missing_token"},
		{"garbage", "Bearer not-a-jwt", "invalid"},
		{"expired", "Bearer " + expired, "expired"},
		{"unknown azp", "Bearer " + foreignParty, "unauthorized_party"},
		{"no sub", "Bearer " + noSubject, "invalid"},
	} {
		obs := &recordedAuth{}
		observeClerkAuth(cfg, tc.header, obs)
		if len(obs.outcomes) != 1 || obs.outcomes[0] != tc.want {
			t.Errorf("%s: outcomes %v, want [%s]", tc.name, obs.outcomes, tc.want)
		}
	}
}

func TestClerkAuthReportsUnavailableConfig(t *testing.T) {
	obs := &recordedAuth{}
	observeClerkAuth(ClerkConfig{}, "Bearer x", obs)
	if len(obs.outcomes) != 1 || obs.outcomes[0] != "unavailable" {
		t.Fatalf("outcomes %v, want [unavailable]", obs.outcomes)
	}
}

func TestClerkAuthWithoutObserver(t *testing.T) {
	_, cfg := testClerkEnv(t)
	observeClerkAuth(cfg, "", nil) // must not panic
}
