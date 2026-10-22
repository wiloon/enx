package billing

import (
	"context"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"enx-api/billing/credit"
	"enx-api/enx"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// GrantCredits handles POST /api/admin/credits/grant: an admin adds top-up
// credits to any user, named by enx id or email, recorded as GRANT_ADMIN with the reason
// (ADR-049 Decision 2) -- for testing on homelab and for support comps in
// production. Mount behind clerkAuth + RequireAdmin.
func (h *Handler) GrantCredits(c *gin.Context) {
	adjustCredits(c, "GrantCredits", "granted", credit.GrantAdmin)
}

// DeductCredits handles POST /api/admin/credits/deduct: an admin takes
// top-up credits from any user, named by enx id or email, recorded as DEDUCT_ADMIN with the
// reason; the balance may go negative (ADR-049 Decision 3). Mount behind
// clerkAuth + RequireAdmin.
func (h *Handler) DeductCredits(c *gin.Context) {
	adjustCredits(c, "DeductCredits", "deducted", credit.DeductAdmin)
}

// adjustCredits is the shared body of GrantCredits and DeductCredits: resolve
// the user by enx id or by email, apply the ledger change, answer with the
// new balance.
func adjustCredits(c *gin.Context, name, verb string, apply func(ctx context.Context, userID string, amount int64, note string) error) {
	var req adjustCreditsRequest
	err := c.ShouldBindJSON(&req)
	req.UserID = strings.TrimSpace(req.UserID)
	req.Email = strings.TrimSpace(req.Email)
	req.Reason = strings.TrimSpace(req.Reason)
	if err != nil || req.Reason == "" || (req.UserID == "") == (req.Email == "") ||
		(req.Email != "" && !validEmail(req.Email)) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "exactly one of userId or a valid email, a positive amount and a reason are required"})
		return
	}

	user, ok := adjustTarget(c, req)
	if !ok {
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

// adjustTarget finds the one user the request names, or answers the request
// itself: 404 for nobody, 409 with the candidates for an email several users
// share (users.email is not unique, ADR-015 2026-10-20 note §4). userId is
// the enx id; it never falls back to email or the Clerk id.
func adjustTarget(c *gin.Context, req adjustCreditsRequest) (*enx.User, bool) {
	if req.UserID != "" {
		user := enx.GetUserByID(req.UserID)
		if user.Id == "" {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no user with that id"})
			return nil, false
		}
		return user, true
	}

	users, err := enx.GetUsersByEmail(req.Email)
	if err != nil {
		logger.Errorf("admin credits: look up users by email: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to look up the user"})
		return nil, false
	}
	switch len(users) {
	case 0:
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no user with that email (they must sign in at least once first)"})
		return nil, false
	case 1:
		return &users[0], true
	}
	candidates := make([]gin.H, len(users))
	for i, u := range users {
		var lastLoginAt any
		if !u.LastLoginTime.IsZero() {
			lastLoginAt = u.LastLoginTime.UTC().Format(time.RFC3339)
		}
		candidates[i] = gin.H{"userId": u.Id, "status": u.Status, "lastLoginAt": lastLoginAt}
	}
	c.JSON(http.StatusConflict, gin.H{
		"success":    false,
		"code":       "ambiguous_email",
		"message":    "More than one user has that email. Choose one by user ID.",
		"candidates": candidates,
	})
	return nil, false
}

func validEmail(s string) bool {
	addr, err := mail.ParseAddress(s)
	return err == nil && addr.Address == s
}

// adjustCreditsRequest names the user by exactly one of UserID (the enx id)
// and Email.
type adjustCreditsRequest struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	Amount int64  `json:"amount" binding:"required,gt=0"`
	Reason string `json:"reason" binding:"required"`
}
