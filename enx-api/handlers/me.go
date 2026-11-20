package handlers

import (
	"net/http"
	"time"

	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/platform/httpjson"

	"github.com/gin-gonic/gin"
)

// GetMe returns the current user's public fields including status. isAdmin
// reflects the ADMIN_AUTH_SUBJECTS allowlist (ADR-021) and is the only
// signal enx-ui uses to decide whether to render the admin navigation; the
// allowlist itself stays server-side.
func GetMe(admins middleware.AdminAllowlist) gin.HandlerFunc {
	return func(c *gin.Context) { serveMe(c, admins) }
}

func serveMe(c *gin.Context, admins middleware.AdminAllowlist) {
	userID, ok := middleware.RequireUserID(c, "Unauthorized")
	if !ok {
		return
	}
	user := enx.GetUserByID(userID)
	if user.Id == "" {
		httpjson.Fail(c, http.StatusUnauthorized, "User not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":        user.Id,
		"name":      user.Name,
		"email":     user.Email,
		"avatarUrl": user.AvatarUrl,
		"createdAt": user.CreateTime.UTC().Format(time.RFC3339),
		"status":    user.Status,
		"isAdmin":   admins.Contains(c.GetString("auth_subject")),
	})
}
