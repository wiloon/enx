package middleware

import "github.com/gin-gonic/gin"

// GetUserIDFromContext gets user id from gin context
func GetUserIDFromContext(c *gin.Context) string {
	userID, exists := c.Get("user_id")
	if !exists {
		return ""
	}
	return userID.(string)
}
