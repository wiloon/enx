package middleware

import (
	"net/http"

	"enx-api/platform/httpjson"

	"github.com/gin-gonic/gin"
)

// GetUserIDFromContext gets user id from gin context
func GetUserIDFromContext(c *gin.Context) string {
	userID, exists := c.Get("user_id")
	if !exists {
		return ""
	}
	return userID.(string)
}

// RequireUserID returns the signed-in user's id. With no user in the
// context it answers 401 with the standard failure body carrying message
// and returns ok false; the handler then just returns.
func RequireUserID(c *gin.Context, message string) (userID string, ok bool) {
	userID = GetUserIDFromContext(c)
	if userID == "" {
		httpjson.Fail(c, http.StatusUnauthorized, message)
		return "", false
	}
	return userID, true
}
