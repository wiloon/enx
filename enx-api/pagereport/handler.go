package pagereport

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/email"
	"enx-api/middleware"
	"enx-api/utils/logger"
)

type submitRequest struct {
	URL        string `json:"url"`
	Reason     string `json:"reason"`
	Adapter    string `json:"adapter"`
	ExtVersion string `json:"extVersion"`
}

// SubmitHandler handles POST /api/page-reports.
//
// Not on the metered path: it looks up no words, calls no model and touches
// no credits, so it sits outside ADR-018's single metering seam (same as the
// stats and admin endpoints).
func SubmitHandler(c *gin.Context) {
	var req submitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	now := time.Now()
	recorded, err := Submit(c.Request.Context(), userID, Input{
		URL:        req.URL,
		Reason:     req.Reason,
		Adapter:    req.Adapter,
		ExtVersion: req.ExtVersion,
	}, now)
	if err != nil {
		if errors.Is(err, ErrInvalidURL) || errors.Is(err, ErrInvalidReason) || errors.Is(err, ErrInvalidField) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		logger.Errorf("pagereport: submit failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not record the report"})
		return
	}

	if recorded {
		pageURL, host, _ := SanitizeURL(req.URL)
		if notifyErr := email.NotifyAdminPageReport(email.PageReportNotify{
			URL:        pageURL,
			Host:       host,
			Reason:     req.Reason,
			Adapter:    req.Adapter,
			ExtVersion: req.ExtVersion,
			CreatedAt:  now,
		}); notifyErr != nil {
			logger.Errorf("pagereport: admin notify failed: %v", notifyErr)
		}
	}

	// A repeat within the dedupe window is a 200 with recorded:false, so the
	// extension can treat "already reported" as done.
	c.JSON(http.StatusOK, gin.H{"success": true, "recorded": recorded})
}

// ListHandler handles GET /api/admin/page-reports (ADR-010 Decision 11).
// Mount behind clerkAuth + RequireAdmin.
func ListHandler(c *gin.Context) {
	reports, err := ListRecent(c.Request.Context(), DefaultListLimit)
	if err != nil {
		logger.Errorf("pagereport: list failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not list page reports"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "reports": reports})
}
