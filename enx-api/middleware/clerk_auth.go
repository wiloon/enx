package middleware

import (
	"enx-api/enx"
	"enx-api/utils/logger"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

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
}

// ClerkConfigFromViper loads Clerk settings from viper / env.
func ClerkConfigFromViper() ClerkConfig {
	return ClerkConfig{
		Issuer:            viper.GetString("clerk.issuer"),
		AuthorizedParties: viper.GetStringSlice("clerk.authorized-parties"),
		JWKSURL:           viper.GetString("clerk.jwks-url"),
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

// ClerkAuth validates Clerk session-token JWTs and provisions local users.
func ClerkAuth(cfg ClerkConfig) gin.HandlerFunc {
	if !cfg.valid() {
		logger.Errorf("ClerkAuth: incomplete config (issuer=%q parties=%d)", cfg.Issuer, len(cfg.AuthorizedParties))
		return func(c *gin.Context) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth service unavailable"})
			c.Abort()
		}
	}

	v, err := newClerkValidator(cfg)
	if err != nil {
		logger.Errorf("ClerkAuth: JWKS init failed: %v", err)
		return func(c *gin.Context) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth service unavailable"})
			c.Abort()
		}
	}

	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}

		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			c.Abort()
			return
		}
		tokenStr := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))

		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, v.jwks.Keyfunc,
			jwt.WithValidMethods([]string{"RS256"}),
			jwt.WithIssuer(v.cfg.Issuer),
			jwt.WithLeeway(5*time.Second),
		)
		if err != nil || !token.Valid {
			msg := "invalid token"
			if err != nil {
				if strings.Contains(err.Error(), "expired") {
					msg = "token expired"
				}
				logger.Debugf("ClerkAuth: parse failed: %v", err)
			}
			c.JSON(http.StatusUnauthorized, gin.H{"error": msg})
			c.Abort()
			return
		}

		if !v.authorizedPartyAllowed(claims) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			c.Abort()
			return
		}

		sub, _ := claims["sub"].(string)
		if sub == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			c.Abort()
			return
		}

		email, _ := claims["email"].(string)
		name, _ := claims["name"].(string)

		userID, err := enx.GetOrCreateByClerkUserID(sub, email, name)
		if err != nil {
			logger.Errorf("ClerkAuth: provision user clerk_user_id=%s: %v", sub, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			c.Abort()
			return
		}

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
