package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// IsAdminClerkUser reports whether the given Clerk user id (`sub`) is in the
// ADMIN_CLERK_USER_IDS allowlist (viper key `admin.clerk-user-ids`). An empty
// allowlist means nobody is admin -- the admin endpoints are effectively off.
//
// This is deliberately not a roles system (ADR-021): with a single admin
// (the repo owner) an env allowlist is proportional. Migrate to Clerk
// publicMetadata when a second admin, a churning list, or a second role
// appears -- the change is confined to this file plus GetMe's isAdmin.
func IsAdminClerkUser(clerkUserID string) bool {
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

// RequireAdmin aborts with 403 unless the request's Clerk user id (set by
// ClerkAuth as "clerk_user_id") is in the admin allowlist. Mount it after
// ClerkAuth.
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !IsAdminClerkUser(c.GetString("clerk_user_id")) {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
