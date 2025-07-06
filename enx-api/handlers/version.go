package handlers

import (
	"enx-server/version"
	"net/http"

	"github.com/gin-gonic/gin"
)

// VersionResponse version API response structure
type VersionResponse struct {
	Success bool          `json:"success"`
	Data    *version.Info `json:"data"`
	Message string        `json:"message"`
}

// GetVersion returns version information API
func GetVersion(c *gin.Context) {
	info := version.GetVersionInfo()

	// Optional: add uptime information
	// This can be extended to calculate uptime based on start time

	c.JSON(http.StatusOK, VersionResponse{
		Success: true,
		Data:    info,
		Message: "Version information retrieved successfully",
	})
}

// GetVersionSimple returns simple version information API
func GetVersionSimple(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"version":    version.Version,
		"commit":     version.GitCommit,
		"build_time": version.BuildTime,
	})
}
