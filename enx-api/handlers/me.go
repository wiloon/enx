package handlers

import (
	"net/http"

	"enx-api/enx"
	"enx-api/middleware"

	"github.com/gin-gonic/gin"
)

// GetMe returns the current user's public fields including status. isAdmin
// reflects the ADMIN_CLERK_USER_IDS allowlist (ADR-021) and is the only
// signal enx-ui uses to decide whether to render the admin navigation; the
// allowlist itself stays server-side.
func GetMe(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}
	user := enx.GetUserByID(userID)
	if user.Id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "User not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":      user.Id,
		"name":    user.Name,
		"email":   user.Email,
		"status":  user.Status,
		"isAdmin": middleware.IsAdminClerkUser(c.GetString("clerk_user_id")),
	})
}
