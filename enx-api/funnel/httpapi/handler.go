// Package httpapi serves the admin funnel report.
package httpapi

import (
	"net/http"
	"time"

	"enx-api/funnel"
	"enx-api/platform/httpjson"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// Register mounts GET /funnel on r, which must already admit admins only.
func Register(r gin.IRouter, svc *funnel.Service) {
	r.GET("/funnel", func(c *gin.Context) {
		cohorts, err := svc.Report(c.Request.Context())
		if err != nil {
			logger.Errorf("admin funnel: %v", err)
			httpjson.Fail(c, http.StatusInternalServerError, "failed to load the funnel")
			return
		}
		out := make([]cohortJSON, len(cohorts))
		for i, co := range cohorts {
			out[i] = cohortJSON{
				WeekStart:       co.WeekStart.Format(time.DateOnly),
				SignedUp:        co.SignedUp,
				FirstLookup:     co.FirstLookup,
				ThreeLookupDays: co.ThreeLookupDays,
				Week2:           co.Week2,
				Week4:           co.Week4,
				FirstAICall:     co.FirstAICall,
				TrialEnded:      co.TrialEnded,
				FirstPayment:    co.FirstPayment,
			}
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "cohorts": out})
	})
}

// cohortJSON is counts only: no user ids, emails, words or URLs.
type cohortJSON struct {
	WeekStart       string `json:"weekStart"`
	SignedUp        int    `json:"signedUp"`
	FirstLookup     int    `json:"firstLookup"`
	ThreeLookupDays *int   `json:"threeLookupDays"`
	Week2           *int   `json:"week2"`
	Week4           *int   `json:"week4"`
	FirstAICall     int    `json:"firstAiCall"`
	TrialEnded      int    `json:"trialEnded"`
	FirstPayment    int    `json:"firstPayment"`
}
