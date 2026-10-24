package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"enx-api/billing/conflict"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// SupportRequester records a user's billing-support request on their
// subscription conflict: *billingsupport.Service in production.
type SupportRequester interface {
	Request(ctx context.Context, userID, subscriptionID, message string) (conflict.Support, error)
}

// SupportHandler is the HTTP edge of the billing-support form on a blocked
// /billing page (ADR-067 §管理员处理与邮件).
type SupportHandler struct {
	requests SupportRequester
}

// NewSupportHandler returns the billing-support edge.
func NewSupportHandler(requests SupportRequester) *SupportHandler {
	return &SupportHandler{requests: requests}
}

type supportRequest struct {
	SubscriptionID string `json:"subscriptionId"`
	Message        string `json:"message"`
}

// Submit handles POST /api/billing/support. Mount behind clerkAuth: the
// requester is the signed-in user, never a field of the body. A repeated
// request answers with the first one, which still stands.
func (h *SupportHandler) Submit(c *gin.Context) {
	var req supportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		supportFailure(c, http.StatusBadRequest, "A subscription ID and a message are required.")
		return
	}
	userID := middleware.GetUserIDFromContext(c)
	support, err := h.requests.Request(c.Request.Context(), userID, req.SubscriptionID, req.Message)
	switch {
	case errors.Is(err, conflict.ErrNotOwnedConflict):
		supportFailure(c, http.StatusNotFound, "No subscription issue was found for your account.")
		return
	case errors.Is(err, conflict.ErrBlankMessage):
		supportFailure(c, http.StatusBadRequest, "Please enter a message.")
		return
	case errors.Is(err, conflict.ErrMessageTooLong):
		supportFailure(c, http.StatusBadRequest, fmt.Sprintf("Your message must be at most %d characters.", conflict.MaxSupportMessageLength))
		return
	case err != nil:
		logger.Errorf("billing: support request on %s by %s failed: %v", req.SubscriptionID, userID, err)
		supportFailure(c, http.StatusServiceUnavailable, "Your message could not be sent right now. Please try again later.")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Your message was sent. An administrator will look into your subscription.",
		"supportRequest": gin.H{
			"message": support.Message,
			"sentAt":  support.At.UTC().Format(time.RFC3339),
		},
	})
}

func supportFailure(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"success": false, "message": message})
}
