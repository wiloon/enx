package httpapi

import (
	"context"
	"net/http"

	"enx-api/dictionary"
	"enx-api/ecdict"

	"github.com/gin-gonic/gin"
)

// RespondUnavailable writes the ADR-mandated 503 JSON response.
func RespondUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"message": ecdict.UnavailableMessage(),
	})
}

// RespondQuotaExceeded writes the 429 response for a user who has hit their
// daily dictionary lookup limit -- distinct from the 503 above, which means
// "the service itself is unavailable" (TASK-SPEC §4.2).
//
// A paid-tier user hitting their ceiling is not an upsell moment: that tier is
// set high enough that reaching it means the account is being misused, not
// that they should pay more (ADR-029 Decision 5, ADR-093).
func RespondQuotaExceeded(c *gin.Context, userID string, tiers dictionary.QuotaTierSource) {
	ctx := context.Background()
	if c.Request != nil {
		ctx = c.Request.Context()
	}
	// The error says no more than TierUnknown does here.
	tier, _ := dictionary.QuotaTierOf(ctx, tiers, userID)
	// With an unknown tier there is nothing to upsell.
	message := "Daily dictionary lookup limit reached. Please try again tomorrow."
	switch tier {
	case dictionary.TierFree:
		message = "Daily dictionary lookup limit reached. Upgrade to Catglish Pro for a much higher daily limit."
	case dictionary.TierPaid:
		message = "Daily dictionary lookup limit reached. That is unusually high for a paid account -- please contact support."
	}
	// The code tells the clients this 429 from the request rate limit's
	// too_many_requests (ADR-060 Decision 4).
	body := gin.H{
		"success": false,
		"code":    "lookup_quota_exceeded",
		"message": message,
	}
	// upgrade marks a confirmed free user; it is omitted for the paid tier and
	// when the tier is unknown.
	if tier == dictionary.TierFree {
		body["upgrade"] = true
	}
	c.JSON(http.StatusTooManyRequests, body)
}
