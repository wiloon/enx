package handlers

import "github.com/gin-gonic/gin"

// Ping handles GET /ping, the liveness probe.
func Ping(c *gin.Context) {
	c.JSON(200, gin.H{
		"message": "pong",
	})
}
