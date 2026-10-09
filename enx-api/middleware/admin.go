package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AdminAllowlist is the ADMIN_CLERK_USER_IDS allowlist (config
// admin.clerk-user-ids) of Clerk user ids (`sub`) allowed to call the admin
// endpoints. The zero value, like an empty list, admits nobody -- the admin
// endpoints are then effectively off.
//
// This is deliberately not a roles system (ADR-021): with a single admin
// (the repo owner) an env allowlist is proportional. Migrate to Clerk
// publicMetadata when a second admin, a churning list, or a second role
// appears -- the change is confined to this type plus GetMe's isAdmin.
type AdminAllowlist struct {
	ids []string
}

func NewAdminAllowlist(clerkUserIDs []string) AdminAllowlist {
	return AdminAllowlist{ids: clerkUserIDs}
}

// Contains reports whether clerkUserID is an admin.
func (a AdminAllowlist) Contains(clerkUserID string) bool {
	if clerkUserID == "" {
		return false
	}
	for _, id := range a.ids {
		if strings.TrimSpace(id) == clerkUserID {
			return true
		}
	}
	return false
}

// Require aborts with 403 unless the request's Clerk user id (set by
// ClerkAuth as "clerk_user_id") is in the allowlist. Mount it after
// ClerkAuth.
func (a AdminAllowlist) Require() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.Contains(c.GetString("clerk_user_id")) {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
