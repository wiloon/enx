package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS allows only the Chrome extension origins in Clerk authorized parties.
// Website and Firefox parties do not grant cross-origin browser access.
func CORS(allowed []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		isAllowed := false
		for _, allowedOrigin := range allowed {
			if strings.HasPrefix(allowedOrigin, "chrome-extension://") && origin == allowedOrigin {
				isAllowed = true
				break
			}
		}

		if isAllowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, QUERY, OPTIONS, PUT, DELETE")
			// X-Enx-Tz-Offset is read by stats.TZOffsetMiddleware (ADR-029
			// Decision 7a); without it here, preflight rejects the header and
			// the whole cross-origin request fails once a client starts sending it.
			c.Header("Access-Control-Allow-Headers", "Origin, Authorization, X-Session-ID, X-User-ID, Content-Type, Cookie, X-Enx-Tz-Offset")
			c.Header("Access-Control-Expose-Headers", "Content-Length")
			c.Header("Access-Control-Max-Age", "43200") // 12 hours
		}

		// Handle preflight requests
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
