package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// FreeDailyLookupLimit serves GET /api/dictionary/free-daily-lookup-limit:
// the free-tier daily dictionary lookup ceiling the pricing page advertises
// (ADR-029). Config number only; no session, no database.
func FreeDailyLookupLimit(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"free_daily_lookup_limit": limit})
	}
}
