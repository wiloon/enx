package middleware

import (
	"enx-api/platform/httpjson"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AdminAllowlist is the ADMIN_AUTH_SUBJECTS allowlist (config
// admin.auth-subjects) of external auth subjects (`sub`) allowed to call the admin
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

func NewAdminAllowlist(authSubjects []string) AdminAllowlist {
	return AdminAllowlist{ids: authSubjects}
}

// Contains reports whether authSubject is an admin.
func (a AdminAllowlist) Contains(authSubject string) bool {
	if authSubject == "" {
		return false
	}
	for _, id := range a.ids {
		if strings.TrimSpace(id) == authSubject {
			return true
		}
	}
	return false
}

// Require aborts with 403 unless the request's auth subject (set by
// ClerkAuth as "auth_subject") is in the allowlist. Mount it after
// ClerkAuth.
func (a AdminAllowlist) Require() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.Contains(c.GetString("auth_subject")) {
			httpjson.Fail(c, http.StatusForbidden, "admin access required")
			c.Abort()
			return
		}
		c.Next()
	}
}
