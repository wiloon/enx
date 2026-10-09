package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAdminAllowlistContains(t *testing.T) {
	tests := []struct {
		name        string
		configured  []string
		clerkUserID string
		want        bool
	}{
		{"empty allowlist -> nobody is admin", nil, "user_abc", false},
		{"empty clerk id -> not admin", []string{"user_abc"}, "", false},
		{"id in allowlist", []string{"user_abc", "user_def"}, "user_def", true},
		{"id not in allowlist", []string{"user_abc"}, "user_zzz", false},
		{"surrounding whitespace tolerated", []string{" user_abc ", "user_def"}, "user_abc", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewAdminAllowlist(tt.configured).Contains(tt.clerkUserID); got != tt.want {
				t.Fatalf("Contains(%q) = %v, want %v", tt.clerkUserID, got, tt.want)
			}
		})
	}
}

// requireAdminResult drives admins.Require with clerkUserID already on the
// context (what ClerkAuth sets) and reports the resulting status code.
func requireAdminResult(t *testing.T, admins AdminAllowlist, setClerkID bool, clerkUserID string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/x", func(c *gin.Context) {
		if setClerkID {
			c.Set("clerk_user_id", clerkUserID)
		}
		c.Next()
	}, admins.Require(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	return w.Code
}

func TestRequireAdmin(t *testing.T) {
	t.Run("no clerk id on context -> 403", func(t *testing.T) {
		if got := requireAdminResult(t, NewAdminAllowlist([]string{"user_admin"}), false, ""); got != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", got)
		}
	})
	t.Run("clerk id not in allowlist -> 403", func(t *testing.T) {
		if got := requireAdminResult(t, NewAdminAllowlist([]string{"user_admin"}), true, "user_someone_else"); got != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", got)
		}
	})
	t.Run("empty allowlist -> 403 even for a real user", func(t *testing.T) {
		if got := requireAdminResult(t, AdminAllowlist{}, true, "user_admin"); got != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", got)
		}
	})
	t.Run("clerk id in allowlist -> passes through", func(t *testing.T) {
		if got := requireAdminResult(t, NewAdminAllowlist([]string{"user_admin"}), true, "user_admin"); got != http.StatusOK {
			t.Fatalf("status = %d, want 200", got)
		}
	})
}
