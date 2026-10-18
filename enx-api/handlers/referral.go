package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"enx-api/middleware"
	"enx-api/referral"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// ReferralService is the slice of referral.Service the handlers use.
type ReferralService interface {
	Me(ctx context.Context, userID string) (referral.Summary, error)
	Claim(ctx context.Context, inviteeID, code string) (referral.ClaimResult, error)
	Offer() referral.Offer
}

// ReferralHandler serves the invite-link API (ADR-051). Me and Claim go
// behind clerkAuth; Offer is public, for the landing page.
type ReferralHandler struct {
	svc             ReferralService
	frontendBaseURL string
}

// NewReferralHandler builds the handler. frontendBaseURL is enx-ui's origin,
// where the /invite/<code> landing page lives.
func NewReferralHandler(svc ReferralService, frontendBaseURL string) *ReferralHandler {
	return &ReferralHandler{svc: svc, frontendBaseURL: strings.TrimRight(frontendBaseURL, "/")}
}

// Me handles GET /api/referral/me. Times are Unix seconds.
func (h *ReferralHandler) Me(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	sum, err := h.svc.Me(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("referral: me %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load your invites"})
		return
	}
	pending := make([]gin.H, len(sum.Pending))
	for i, p := range sum.Pending {
		pending[i] = gin.H{"amount": p.Amount, "dueAt": p.DueAt.Unix()}
	}
	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"code":           sum.Code,
		"link":           h.frontendBaseURL + "/invite/" + sum.Code,
		"invited":        sum.Invited,
		"paid":           sum.Paid,
		"pendingRewards": pending,
		"totalEarned":    sum.TotalEarned,
	})
}

type referralClaimRequest struct {
	Code string `json:"code" binding:"required"`
}

// referralClaimMessages explain a refusal; enx-ui only logs them (ADR-051
// Decision 2).
var referralClaimMessages = map[referral.Reason]string{
	referral.ReasonClaimWindowClosed: "Invites can only be claimed in the first hours after sign-up.",
	referral.ReasonAlreadyClaimed:    "This account has already claimed an invite.",
	referral.ReasonCodeNotFound:      "No such invite code.",
	referral.ReasonOwnCode:           "You can't claim your own invite.",
	referral.ReasonAlreadyPaid:       "Invites are for accounts that haven't paid yet.",
}

// Claim handles POST /api/referral/claim {code}. A refusal is 409 with a
// reason code. trialExpiresAt is Unix seconds, null when no bonus was
// granted.
func (h *ReferralHandler) Claim(c *gin.Context) {
	var req referralClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "code is required"})
		return
	}
	userID := middleware.GetUserIDFromContext(c)
	res, err := h.svc.Claim(c.Request.Context(), userID, req.Code)
	var ce *referral.ClaimError
	if errors.As(err, &ce) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "reason": ce.Reason, "message": referralClaimMessages[ce.Reason]})
		return
	}
	if err != nil {
		logger.Errorf("referral: claim by %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to claim the invite"})
		return
	}
	var expiresAt *int64
	if !res.TrialExpiresAt.IsZero() {
		unix := res.TrialExpiresAt.Unix()
		expiresAt = &unix
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "bonus": res.Bonus, "trialExpiresAt": expiresAt})
}

// Offer handles GET /api/referral/offer: what an invitee gets.
func (h *ReferralHandler) Offer(c *gin.Context) {
	o := h.svc.Offer()
	c.JSON(http.StatusOK, gin.H{"success": true, "credits": o.Credits, "days": o.Days})
}
