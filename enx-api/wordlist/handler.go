package wordlist

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/middleware"
	"enx-api/utils/logger"
)

type entryResponse struct {
	English         string `json:"english"`
	Chinese         string `json:"chinese"`
	Pronunciation   string `json:"pronunciation"`
	QueryCount      int    `json:"queryCount"`
	Known           bool   `json:"known"`
	FirstLookedUpAt string `json:"firstLookedUpAt"`
	UpdatedAt       string `json:"updatedAt"`
}

// ListHandler handles GET /api/me/words?status=all|learning|known&q=&limit=&offset=.
//
// Not on the metered path: it reads the user's own rows and looks nothing up,
// so it sits outside ADR-018's single metering seam.
func ListHandler(c *gin.Context) {
	status, err := ParseStatus(c.Query("status"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "status must be all, learning or known"})
		return
	}
	limit, err := intParam(c, "limit")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "limit must be a whole number"})
		return
	}
	offset, err := intParam(c, "offset")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "offset must be a whole number"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	page, err := List(c.Request.Context(), userID, Query{
		Status: status,
		Search: c.Query("q"),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		logger.Errorf("wordlist: list failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not load your word list"})
		return
	}

	out := make([]entryResponse, len(page.Entries))
	for i, e := range page.Entries {
		out[i] = entryResponse{
			English:         e.English,
			Chinese:         e.Chinese,
			Pronunciation:   e.Pronunciation,
			QueryCount:      e.QueryCount,
			Known:           e.Known,
			FirstLookedUpAt: e.FirstLookedUpAt.Format(time.RFC3339),
			UpdatedAt:       e.UpdatedAt.Format(time.RFC3339),
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "total": page.Total, "words": out})
}

var errNotInt = errors.New("not an integer")

// intParam reads an optional integer query parameter; absent means 0, which
// Query.normalize turns into the default.
func intParam(c *gin.Context, name string) (int, error) {
	raw := c.Query(name)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errNotInt
	}
	return n, nil
}
