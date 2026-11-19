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

// RespondQuotaExceededWithSubscriptions writes the 429 response for a user who
// has hit their daily dictionary lookup limit -- distinct from the 503 above,
// which means "the service itself is unavailable" (TASK-SPEC §4.2).
//
// A subscriber hitting their ceiling is not an upsell moment: that tier is set
// high enough that reaching it means the account is being misused, not that
// they should pay more (ADR-029 Decision 5).
func RespondQuotaExceededWithSubscriptions(c *gin.Context, userID string, subs dictionary.Subscriptions) {
	message := "Daily dictionary lookup limit reached. Upgrade to Catglish Pro for a much higher daily limit."
	ctx := context.Background()
	if c.Request != nil {
		ctx = c.Request.Context()
	}
	subscribed, err := subs.IsActiveSubscriber(ctx, userID)
	if err == nil && subscribed {
		message = "Daily dictionary lookup limit reached. That is unusually high for a subscription -- please contact support."
	}
	// The code tells the clients this 429 from the request rate limit's
	// too_many_requests (ADR-060 Decision 4).
	body := gin.H{
		"success": false,
		"code":    "lookup_quota_exceeded",
		"message": message,
	}
	// upgrade marks a confirmed free user; it is omitted for subscribers and
	// when the subscription lookup failed.
	if err == nil && !subscribed {
		body["upgrade"] = true
	}
	c.JSON(http.StatusTooManyRequests, body)
}
