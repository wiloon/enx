package middleware

import (
	"enx-api/config"
	"enx-api/enx"
	"enx-api/utils/logger"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// clerkClockLeeway is how far a Clerk session token's exp/nbf/iat may be off
// before we reject it. Clerk mints session JWTs with a ~60s TTL and clerk-js
// refreshes them on a timer; that timer is frozen while an MV3 service worker
// (the extension) is suspended, so a just-woken worker can present a token
// that's a few seconds past exp by our clock. A minute of leeway absorbs that
// plus ordinary host clock drift (homelab pods have no tight NTP guarantee)
// without accepting a token more than roughly one extra lifetime stale.
const clerkClockLeeway = 60 * time.Second

// ClerkConfig holds Clerk session-token validation settings.
type ClerkConfig struct {
	// Issuer is the Clerk Frontend API origin, e.g. https://enx.clerk.accounts.dev
	// or a custom domain like https://clerk.catseye.example. It is also the `iss`
	// claim value Clerk stamps on every session token.
	Issuer string
	// AuthorizedParties is the allow-list checked against the token's `azp` claim
	// (the origin the token was minted for): the enx-ui domain and the extension id.
	AuthorizedParties []string
	// JWKSURL overrides the default `<issuer>/.well-known/jwks.json` endpoint (tests only).
	JWKSURL string
	// LastLoginUpdateInterval throttles the last_login_time write for a
	// returning user (user.last-login-update-interval).
	LastLoginUpdateInterval time.Duration
}

// ClerkConfigFrom maps the clerk.* and user.* config onto ClerkConfig.
func ClerkConfigFrom(c config.Clerk, u config.User) ClerkConfig {
	return ClerkConfig{
		Issuer:                  c.Issuer,
		AuthorizedParties:       c.AuthorizedParties,
		JWKSURL:                 c.JWKSURL,
		LastLoginUpdateInterval: u.LastLoginUpdateInterval,
	}
}

func (cfg ClerkConfig) jwksURL() string {
	if cfg.JWKSURL != "" {
		return cfg.JWKSURL
	}
	return strings.TrimRight(cfg.Issuer, "/") + "/.well-known/jwks.json"
}

func (cfg ClerkConfig) valid() bool {
	return cfg.Issuer != "" && len(cfg.AuthorizedParties) > 0
}

type clerkValidator struct {
	cfg  ClerkConfig
	jwks keyfunc.Keyfunc
}

func newClerkValidator(cfg ClerkConfig) (*clerkValidator, error) {
	jwks, err := keyfunc.NewDefault([]string{cfg.jwksURL()})
	if err != nil {
		return nil, err
	}
	return &clerkValidator{cfg: cfg, jwks: jwks}, nil
}

// AuthObserver records how a Clerk token check ended and how long it took:
// metrics.Metrics in production (ADR-040).
type AuthObserver interface {
	ObserveAuth(outcome string, elapsed time.Duration)
}

// Auth outcomes reported to AuthObserver.
const (
	authOK                = "ok"
	authMissingToken      = "missing_token"
	authExpired           = "expired"
	authInvalid           = "invalid"
	authUnauthorizedParty = "unauthorized_party"
	authProvisionError    = "provision_error"
	authUnavailable       = "unavailable"
)

// ClerkAuth validates Clerk session-token JWTs and provisions local users.
// obs, when not nil, hears how every check ended.
func ClerkAuth(cfg ClerkConfig, obs AuthObserver) gin.HandlerFunc {
	observe := func(outcome string, start time.Time) {
		if obs != nil {
			obs.ObserveAuth(outcome, time.Since(start))
		}
	}
	unavailable := func(c *gin.Context) {
		observe(authUnavailable, time.Now())
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth service unavailable"})
		c.Abort()
	}

	if !cfg.valid() {
		logger.Errorf("ClerkAuth: incomplete config (issuer=%q parties=%d)", cfg.Issuer, len(cfg.AuthorizedParties))
		return unavailable
	}

	v, err := newClerkValidator(cfg)
	if err != nil {
		logger.Errorf("ClerkAuth: JWKS init failed: %v", err)
		return unavailable
	}

	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		start := time.Now()
		reject := func(outcome, msg string) {
			observe(outcome, start)
			c.JSON(http.StatusUnauthorized, gin.H{"error": msg})
			c.Abort()
		}

		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			reject(authMissingToken, "missing authorization header")
			return
		}
		tokenStr := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))

		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, v.jwks.Keyfunc,
			jwt.WithValidMethods([]string{"RS256"}),
			jwt.WithIssuer(v.cfg.Issuer),
			jwt.WithLeeway(clerkClockLeeway),
		)
		if err != nil || !token.Valid {
			if err != nil {
				logger.Debugf("ClerkAuth: parse failed: %v", err)
				if strings.Contains(err.Error(), "expired") {
					reject(authExpired, "token expired")
					return
				}
			}
			reject(authInvalid, "invalid token")
			return
		}

		if !v.authorizedPartyAllowed(claims) {
			reject(authUnauthorizedParty, "invalid token")
			return
		}

		sub, _ := claims["sub"].(string)
		if sub == "" {
			reject(authInvalid, "invalid token")
			return
		}

		email, _ := claims["email"].(string)
		name, _ := claims["name"].(string)

		userID, err := enx.GetOrCreateByClerkUserID(sub, email, name, cfg.LastLoginUpdateInterval)
		if err != nil {
			logger.Errorf("ClerkAuth: provision user clerk_user_id=%s: %v", sub, err)
			observe(authProvisionError, start)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			c.Abort()
			return
		}

		observe(authOK, start)
		c.Set("clerk_user_id", sub)
		c.Set("user_id", userID)
		c.Next()
	}
}

// authorizedPartyAllowed follows Clerk's documented manual-verification pattern:
// the `azp` claim is validated only when present. Clerk stamps it with the
// origin the token was minted for; it can be absent for flows with no Origin
// header. An absent azp is allowed; a present-but-unknown azp is rejected.
func (v *clerkValidator) authorizedPartyAllowed(claims jwt.MapClaims) bool {
	azp, _ := claims["azp"].(string)
	if azp == "" {
		return true
	}
	return contains(v.cfg.AuthorizedParties, azp)
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}
