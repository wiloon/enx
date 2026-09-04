package billing

import (
	"net/http"
	"strings"

	"enx-api/billing/credit"
	"enx-api/enx"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/spf13/viper"
)

// isAdminClerkUser reports whether the given Clerk user id (`sub`) is in the
// ADMIN_CLERK_USER_IDS allowlist. An empty allowlist means the admin
// endpoints are effectively disabled. Not a roles system -- see
// docs/architecture/adr-015 discussion; migrate to Clerk publicMetadata if
// this outgrows an env var.
func isAdminClerkUser(clerkUserID string) bool {
	if clerkUserID == "" {
		return false
	}
	for _, id := range viper.GetStringSlice("admin.clerk-user-ids") {
		if strings.TrimSpace(id) == clerkUserID {
			return true
		}
	}
	return false
}

// GrantCredits handles POST /api/admin/credits/grant: an admin adds top-up
// credits to any user by email. Same ledger path as a Stripe top-up
// (credit.GrantTopup), just triggered manually -- for testing on homelab and
// for support comps in production.
func (h *Handler) GrantCredits(c *gin.Context) {
	if !isAdminClerkUser(c.GetString("clerk_user_id")) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "admin access required"})
		return
	}

	var req grantCreditsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "email and a positive amount are required"})
		return
	}

	user := enx.GetUserByEmail(req.Email)
	if user.Id == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no user with that email (they must sign in at least once first)"})
		return
	}

	// credit.GrantTopup dedups on this key like a Stripe event id; use a fresh
	// one per call so repeated admin grants each land.
	eventID := "admin-grant-" + uuid.NewString()
	if err := credit.GrantTopup(c.Request.Context(), user.Id, req.Amount, eventID); err != nil {
		logger.Errorf("admin GrantCredits: GrantTopup(user=%s amount=%d) failed: %v", user.Id, req.Amount, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to grant credits"})
		return
	}

	balance, err := credit.Balance(c.Request.Context(), user.Id)
	if err != nil {
		logger.Errorf("admin GrantCredits: Balance(user=%s) failed: %v", user.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "granted, but failed to read new balance"})
		return
	}

	logger.Infof("admin GrantCredits: %s granted %d credits to user=%s (email=%s reason=%q), new balance=%d",
		c.GetString("clerk_user_id"), req.Amount, user.Id, user.Email, req.Reason, balance)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"userId":  user.Id,
		"email":   user.Email,
		"granted": req.Amount,
		"balance": balance,
		"reason":  req.Reason,
	})
}

type grantCreditsRequest struct {
	Email  string `json:"email" binding:"required,email"`
	Amount int64  `json:"amount" binding:"required,gt=0"`
	Reason string `json:"reason"`
}
