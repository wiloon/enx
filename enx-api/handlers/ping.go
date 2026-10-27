package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Ping handles GET /ping, the liveness probe.
func Ping(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"message": "pong",
	})
}
