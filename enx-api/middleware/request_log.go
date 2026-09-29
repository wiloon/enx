package middleware

import (
	"enx-api/metrics"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestLog writes one structured line per request once it has been
// handled: method, route, status, duration and the caller's user id, plus
// lookup_source when a word lookup tagged one (ADR-040). The route is gin's
// template ("/api/word/:word"), never the raw path, because
// the path carries what the user looked up. CORS preflights are skipped.
// Pass logger.Infow as log.
func RequestLog(log func(msg string, keysAndValues ...interface{})) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		start := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		fields := []interface{}{
			"method", c.Request.Method,
			"route", route,
			"status", c.Writer.Status(),
			"duration_ms", float64(time.Since(start).Microseconds()) / 1000,
			"user_id", c.GetString("user_id"),
		}
		if source := c.GetString(metrics.LookupSourceKey); source != "" {
			fields = append(fields, "lookup_source", source)
		}
		log("request", fields...)
	}
}
