package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// TrialTerms serves GET /api/billing/trial-terms: the sign-up trial amount
// and length the pricing page and /welcome advertise (ADR-098 Decision 9,
// ADR-048). Config numbers only; no session, no database. amount = 0 or
// ttl-days = 0 is off: both fields come back as 0 so clients never guess.
func TrialTerms(amount int64, ttlDays int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if amount == 0 || ttlDays == 0 {
			c.JSON(http.StatusOK, gin.H{"amount": 0, "ttl_days": 0})
			return
		}
		c.JSON(http.StatusOK, gin.H{"amount": amount, "ttl_days": ttlDays})
	}
}
