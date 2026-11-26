// Package aifailure writes the 502 an AI feature answers with, which tells the
// user whether ENX or the upstream AI service failed (#1153). The messages are
// shown as they are: they name no provider and say nothing about credits.
package aifailure

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Internal answers a failure on ENX's side, before the model was called.
func Internal(c *gin.Context) {
	respond(c, "internal_error", "Something went wrong on our side. Please try again later.")
}

// Upstream answers a failure of the AI service: the call failed or timed out,
// or its reply was empty or unusable.
func Upstream(c *gin.Context) {
	respond(c, "ai_upstream_failed", "The AI service is having trouble right now. Please try again.")
}

func respond(c *gin.Context, code, message string) {
	c.JSON(http.StatusBadGateway, gin.H{"success": false, "code": code, "message": message})
}
