// Package httpjson holds the JSON response shapes shared by enx-api handlers.
package httpjson

import "github.com/gin-gonic/gin"

// Fail writes the standard failure body {"success": false, "message": message}
// with the given HTTP status.
func Fail(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"success": false, "message": message})
}
