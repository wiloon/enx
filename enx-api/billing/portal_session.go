package billing

import (
	"context"
	"errors"
	"net/http"

	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// PortalSessions creates a user's Stripe Customer Portal sessions:
// *portalsession.Service in production.
type PortalSessions interface {
	Home(ctx context.Context, userID string) (string, error)
	PlanChange(ctx context.Context, userID, tier string) (string, error)
}

// PortalSessionHandler is the HTTP edge of /billing "Manage subscription"
// and of a tier card's plan-change button (ADR-067 §改档由 Stripe Customer
// Portal 完成). Mount behind clerkAuth: the user is the signed-in one.
type PortalSessionHandler struct {
	sessions PortalSessions
}

// NewPortalSessionHandler returns the Portal session edge.
func NewPortalSessionHandler(sessions PortalSessions) *PortalSessionHandler {
	return &PortalSessionHandler{sessions: sessions}
}

type planChangeRequest struct {
	Tier string `json:"tier"`
}

const (
	portalUnavailableMessage = "The billing portal is unavailable right now. Please try again later."
	unknownTierMessage       = `tier must be "pro", "pro-plus", or "max"`
)

// Home handles POST /api/billing/portal: the Portal home, under the
// restricted configuration while the user is blocked.
func (h *PortalSessionHandler) Home(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	url, err := h.sessions.Home(c.Request.Context(), userID)
	if err != nil {
		portalSessionFailure(c, "home", userID, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "url": url})
}

// PlanChange handles POST /api/billing/portal/plan-change with {"tier"}:
// the subscription_update_confirm deep link to that tier, or the Portal
// home while Stripe already holds a change. A refusal answers 409 with a
// reason the page can act on: subscription_conflict leads to billing
// support.
func (h *PortalSessionHandler) PlanChange(c *gin.Context) {
	var req planChangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": unknownTierMessage})
		return
	}
	userID := middleware.GetUserIDFromContext(c)
	url, err := h.sessions.PlanChange(c.Request.Context(), userID, req.Tier)
	if err != nil {
		portalSessionFailure(c, "plan change to "+req.Tier, userID, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "url": url})
}

func portalSessionFailure(c *gin.Context, action, userID string, err error) {
	var blocked *portalsession.BlockedError
	switch {
	case errors.As(err, &blocked) && blocked.Reason == eligibility.ReasonDeletionInProgress:
		planChangeRefused(c, blocked.Reason, "Your account is being deleted, so your plan can't be changed.")
	case errors.As(err, &blocked):
		planChangeRefused(c, eligibility.ReasonSubscriptionConflict,
			"Your subscription needs an administrator's attention before you can change plans. Contact billing support.")
	case errors.Is(err, portalsession.ErrNotAPlanChange):
		planChangeRefused(c, "not_a_plan_change",
			"There is no plan change to make: you are already on this plan, or you have no active subscription to change.")
	case errors.Is(err, portalsession.ErrUnknownSubscriptionPrice):
		logger.Errorf("billing: portal %s for %s refused: %v", action, userID, err)
		planChangeRefused(c, "subscription_needs_attention", "Your subscription can't be changed online right now. Contact billing support.")
	case errors.Is(err, portalsession.ErrUnknownTier):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": unknownTierMessage})
	case errors.Is(err, portalsession.ErrNoCustomer):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no billing account yet"})
	default:
		logger.Errorf("billing: portal %s for %s failed: %v", action, userID, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": portalUnavailableMessage})
	}
}

func planChangeRefused(c *gin.Context, reason, message string) {
	c.JSON(http.StatusConflict, gin.H{"success": false, "reason": reason, "message": message})
}
