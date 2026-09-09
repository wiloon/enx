package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func TestIsAdminClerkUser(t *testing.T) {
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
			viper.Set("admin.clerk-user-ids", tt.configured)
			defer viper.Set("admin.clerk-user-ids", nil)
			if got := IsAdminClerkUser(tt.clerkUserID); got != tt.want {
				t.Fatalf("IsAdminClerkUser(%q) = %v, want %v", tt.clerkUserID, got, tt.want)
			}
		})
	}
}

// requireAdminResult drives RequireAdmin with clerkUserID already on the
// context (what ClerkAuth sets) and reports the resulting status code.
func requireAdminResult(t *testing.T, setClerkID bool, clerkUserID string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/x", func(c *gin.Context) {
		if setClerkID {
			c.Set("clerk_user_id", clerkUserID)
		}
		c.Next()
	}, RequireAdmin(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	return w.Code
}

func TestRequireAdmin(t *testing.T) {
	t.Run("no clerk id on context -> 403", func(t *testing.T) {
		viper.Set("admin.clerk-user-ids", []string{"user_admin"})
		defer viper.Set("admin.clerk-user-ids", nil)
		if got := requireAdminResult(t, false, ""); got != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", got)
		}
	})
	t.Run("clerk id not in allowlist -> 403", func(t *testing.T) {
		viper.Set("admin.clerk-user-ids", []string{"user_admin"})
		defer viper.Set("admin.clerk-user-ids", nil)
		if got := requireAdminResult(t, true, "user_someone_else"); got != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", got)
		}
	})
	t.Run("empty allowlist -> 403 even for a real user", func(t *testing.T) {
		viper.Set("admin.clerk-user-ids", nil)
		if got := requireAdminResult(t, true, "user_admin"); got != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", got)
		}
	})
	t.Run("clerk id in allowlist -> passes through", func(t *testing.T) {
		viper.Set("admin.clerk-user-ids", []string{"user_admin"})
		defer viper.Set("admin.clerk-user-ids", nil)
		if got := requireAdminResult(t, true, "user_admin"); got != http.StatusOK {
			t.Fatalf("status = %d, want 200", got)
		}
	})
}
