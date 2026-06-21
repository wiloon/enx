package middleware

import (
	"enx-api/enx"
	"enx-api/utils/logger"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

// CognitoConfig holds AWS Cognito JWT validation settings.
type CognitoConfig struct {
	Region     string
	UserPoolID string
	ClientIDs  []string
	// JWKSURL overrides the default Cognito JWKS endpoint (tests only).
	JWKSURL string
}

// CognitoConfigFromViper loads Cognito settings from viper / env.
func CognitoConfigFromViper() CognitoConfig {
	clientIDs := []string{}
	if id := viper.GetString("cognito.client-id"); id != "" {
		clientIDs = append(clientIDs, id)
	}
	if id := viper.GetString("cognito.chrome-client-id"); id != "" {
		clientIDs = append(clientIDs, id)
	}
	return CognitoConfig{
		Region:     viper.GetString("cognito.region"),
		UserPoolID: viper.GetString("cognito.user-pool-id"),
		ClientIDs:  clientIDs,
		JWKSURL:    viper.GetString("cognito.jwks-url"),
	}
}

func (cfg CognitoConfig) issuer() string {
	return fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s", cfg.Region, cfg.UserPoolID)
}

func (cfg CognitoConfig) jwksURL() string {
	if cfg.JWKSURL != "" {
		return cfg.JWKSURL
	}
	return cfg.issuer() + "/.well-known/jwks.json"
}

func (cfg CognitoConfig) valid() bool {
	return cfg.Region != "" && cfg.UserPoolID != "" && len(cfg.ClientIDs) > 0
}

type cognitoValidator struct {
	cfg    CognitoConfig
	jwks   keyfunc.Keyfunc
	initMu sync.Mutex
}

func newCognitoValidator(cfg CognitoConfig) (*cognitoValidator, error) {
	jwks, err := keyfunc.NewDefault([]string{cfg.jwksURL()})
	if err != nil {
		return nil, err
	}
	return &cognitoValidator{cfg: cfg, jwks: jwks}, nil
}

// CognitoAuth validates Cognito JWT access tokens and provisions local users.
func CognitoAuth(cfg CognitoConfig) gin.HandlerFunc {
	if !cfg.valid() {
		logger.Errorf("CognitoAuth: incomplete config (region=%q pool=%q clients=%d)", cfg.Region, cfg.UserPoolID, len(cfg.ClientIDs))
		return func(c *gin.Context) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth service unavailable"})
			c.Abort()
		}
	}

	v, err := newCognitoValidator(cfg)
	if err != nil {
		logger.Errorf("CognitoAuth: JWKS init failed: %v", err)
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
			jwt.WithIssuer(v.cfg.issuer()),
			jwt.WithLeeway(5*time.Second),
		)
		if err != nil || !token.Valid {
			msg := "invalid token"
			if err != nil {
				if strings.Contains(err.Error(), "expired") {
					msg = "token expired"
				}
				logger.Debugf("CognitoAuth: parse failed: %v", err)
			}
			c.JSON(http.StatusUnauthorized, gin.H{"error": msg})
			c.Abort()
			return
		}

		if !v.audienceAllowed(claims) {
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
		username, _ := claims["username"].(string)
		if username == "" {
			username, _ = claims["cognito:username"].(string)
		}

		userID, err := enx.GetOrCreateByCognitoSub(sub, email, username)
		if err != nil {
			logger.Errorf("CognitoAuth: provision user sub=%s: %v", sub, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			c.Abort()
			return
		}

		c.Set("cognito_sub", sub)
		c.Set("user_id", userID)
		c.Next()
	}
}

func (v *cognitoValidator) audienceAllowed(claims jwt.MapClaims) bool {
	tokenUse, _ := claims["token_use"].(string)
	switch tokenUse {
	case "access":
		clientID, _ := claims["client_id"].(string)
		return contains(v.cfg.ClientIDs, clientID)
	case "id":
		aud := claimAudience(claims)
		return contains(v.cfg.ClientIDs, aud)
	default:
		// Fallback: accept if either client_id or aud matches
		clientID, _ := claims["client_id"].(string)
		if contains(v.cfg.ClientIDs, clientID) {
			return true
		}
		return contains(v.cfg.ClientIDs, claimAudience(claims))
	}
}

func claimAudience(claims jwt.MapClaims) string {
	aud := claims["aud"]
	switch v := aud.(type) {
	case string:
		return v
	case []any:
		if len(v) > 0 {
			if s, ok := v[0].(string); ok {
				return s
			}
		}
	}
	return ""
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}
