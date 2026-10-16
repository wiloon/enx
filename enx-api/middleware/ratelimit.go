package middleware

import (
	"enx-api/ratelimit"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// RateLimitedKey is the gin context key RateLimit sets on a request it
// refused, so RequestLog can mark that line rate_limited=true (ADR-060
// Decision 6).
const RateLimitedKey = "enx.rate_limited"

// RateLimitedMessage is what a refused caller is told; the clients show it
// as is.
const RateLimitedMessage = "Too many requests. Please slow down and try again in a moment."

// RateLimitObserver hears every refused request, by route template:
// metrics.Metrics in production.
type RateLimitObserver interface {
	ObserveRateLimited(route string)
}

// RateLimit applies the per-user request rate limit (ADR-060). It goes right
// after ClerkAuth, which puts the local user id in the context; a refused
// request is answered 429 with Retry-After and code too_many_requests and
// never reaches the handler. obs may be nil.
func RateLimit(limiter ratelimit.Limiter, obs RateLimitObserver) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.Next()
			return
		}
		ok, retryAfter := limiter.Allow(userID)
		if ok {
			c.Next()
			return
		}
		c.Set(RateLimitedKey, true)
		if obs != nil {
			route := c.FullPath()
			if route == "" {
				route = "unmatched"
			}
			obs.ObserveRateLimited(route)
		}
		c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds())))
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"code":    "too_many_requests",
			"message": RateLimitedMessage,
		})
	}
}
