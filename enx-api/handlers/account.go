package handlers

import (
	"errors"
	"net/http"

	"enx-api/account"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// AccountHandler serves account deletion, disabling and signing out
// (ADR-062): DELETE /api/me for the user, the /api/admin/users/:id actions
// for the admin.
type AccountHandler struct {
	svc *account.Service
}

func NewAccountHandler(svc *account.Service) *AccountHandler { return &AccountHandler{svc: svc} }

// DeleteMe handles DELETE /api/me with {"email": "<their email>"}.
func (h *AccountHandler) DeleteMe(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "email_mismatch",
			"message": "Type your email to confirm."})
		return
	}
	userID := middleware.GetUserIDFromContext(c)
	err := h.svc.DeleteOwn(c.Request.Context(), userID, req.Email)
	h.respond(c, "delete_own", userID, err)
}

// Delete handles DELETE /api/admin/users/:id?resetTrial=true.
func (h *AccountHandler) Delete(c *gin.Context) {
	opts := account.DeleteOptions{ResetTrial: c.Query("resetTrial") == "true"}
	err := h.svc.Delete(c.Request.Context(), c.Param("id"), opts)
	action := "delete"
	if opts.ResetTrial {
		action = "delete_reset_trial"
	}
	h.respond(c, action, c.Param("id"), err)
}

// Disable handles POST /api/admin/users/:id/disable.
func (h *AccountHandler) Disable(c *gin.Context) {
	h.respond(c, "disable", c.Param("id"), h.svc.Disable(c.Request.Context(), c.Param("id")))
}

// Enable handles POST /api/admin/users/:id/enable.
func (h *AccountHandler) Enable(c *gin.Context) {
	h.respond(c, "enable", c.Param("id"), h.svc.Enable(c.Request.Context(), c.Param("id")))
}

// RevokeSessions handles POST /api/admin/users/:id/revoke-sessions.
func (h *AccountHandler) RevokeSessions(c *gin.Context) {
	h.respond(c, "revoke_sessions", c.Param("id"), h.svc.RevokeSessions(c.Request.Context(), c.Param("id")))
}

// respond writes the outcome and logs who did what to whom: the request
// line alone does not show the target (ADR-062 Decision 7).
func (h *AccountHandler) respond(c *gin.Context, action, targetUserID string, err error) {
	operator := middleware.GetUserIDFromContext(c)
	if err == nil {
		logger.Infow("account action", "action", action, "operator_user_id", operator, "target_user_id", targetUserID)
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	status, code, message := http.StatusInternalServerError, "failed", "The account action failed. Try again."
	switch {
	case errors.Is(err, account.ErrNotConfigured):
		status, code, message = http.StatusServiceUnavailable, "not_configured", "Account management is not configured."
	case errors.Is(err, account.ErrUserNotFound):
		status, code, message = http.StatusNotFound, "not_found", "No such user."
	case errors.Is(err, account.ErrProtectedAdmin):
		status, code, message = http.StatusForbidden, "admin_account",
			"An admin account cannot be disabled or deleted. Remove it from ADMIN_CLERK_USER_IDS first."
	case errors.Is(err, account.ErrRenewingSubscription):
		status, code, message = http.StatusConflict, "subscription_active",
			"Cancel your subscription on the Billing page before deleting your account."
	case errors.Is(err, account.ErrEmailMismatch):
		status, code, message = http.StatusBadRequest, "email_mismatch", "That email does not match your account."
	default:
		logger.Errorf("account action %s by %s on %s failed: %v", action, operator, targetUserID, err)
	}
	c.JSON(status, gin.H{"success": false, "code": code, "message": message})
}
