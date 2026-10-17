package billing

import (
	"context"
	"net/http"
	"strings"

	"enx-api/billing/credit"
	"enx-api/enx"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// GrantCredits handles POST /api/admin/credits/grant: an admin adds top-up
// credits to any user by email, recorded as GRANT_ADMIN with the reason
// (ADR-049 Decision 2) -- for testing on homelab and for support comps in
// production. Mount behind clerkAuth + RequireAdmin.
func (h *Handler) GrantCredits(c *gin.Context) {
	adjustCredits(c, "GrantCredits", "granted", credit.GrantAdmin)
}

// DeductCredits handles POST /api/admin/credits/deduct: an admin takes
// top-up credits from any user by email, recorded as DEDUCT_ADMIN with the
// reason; the balance may go negative (ADR-049 Decision 3). Mount behind
// clerkAuth + RequireAdmin.
func (h *Handler) DeductCredits(c *gin.Context) {
	adjustCredits(c, "DeductCredits", "deducted", credit.DeductAdmin)
}

// adjustCredits is the shared body of GrantCredits and DeductCredits: resolve
// the user by email, apply the ledger change, answer with the new balance.
func adjustCredits(c *gin.Context, name, verb string, apply func(ctx context.Context, userID string, amount int64, note string) error) {
	var req adjustCreditsRequest
	err := c.ShouldBindJSON(&req)
	req.Reason = strings.TrimSpace(req.Reason)
	if err != nil || req.Reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "email, a positive amount and a reason are required"})
		return
	}

	user := enx.GetUserByEmail(req.Email)
	if user.Id == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no user with that email (they must sign in at least once first)"})
		return
	}

	ctx := c.Request.Context()
	if err := apply(ctx, user.Id, req.Amount, req.Reason); err != nil {
		logger.Errorf("admin %s(user=%s amount=%d) failed: %v", name, user.Id, req.Amount, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to update credits"})
		return
	}

	balance, err := credit.Balance(ctx, user.Id)
	if err != nil {
		logger.Errorf("admin %s: Balance(user=%s) failed: %v", name, user.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "credits updated, but failed to read new balance"})
		return
	}

	logger.Infof("admin %s: %s %s %d credits for user=%s (email=%s reason=%q), new balance=%d",
		name, c.GetString("clerk_user_id"), verb, req.Amount, user.Id, user.Email, req.Reason, balance)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"userId":  user.Id,
		"email":   user.Email,
		verb:      req.Amount,
		"balance": balance,
		"reason":  req.Reason,
	})
}

type adjustCreditsRequest struct {
	Email  string `json:"email" binding:"required,email"`
	Amount int64  `json:"amount" binding:"required,gt=0"`
	Reason string `json:"reason" binding:"required"`
}
