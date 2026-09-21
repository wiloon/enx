package savedpage

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/middleware"
	"enx-api/urlnorm"
	"enx-api/utils/logger"
)

type pageResponse struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	Host      string `json:"host"`
	CreatedAt string `json:"createdAt"`
}

func toResponse(p Page) pageResponse {
	return pageResponse{
		ID:        p.ID,
		URL:       p.URL,
		Title:     p.Title,
		Host:      p.Host,
		CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339),
	}
}

type saveRequest struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// SaveHandler handles POST /api/saved-pages.
//
// Not on the metered path: it looks up no words, calls no model and touches
// no credits, so it sits outside ADR-018's single metering seam.
func SaveHandler(c *gin.Context) {
	var req saveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	page, created, err := Save(c.Request.Context(), userID, Input{
		URL:   req.URL,
		Title: req.Title,
	}, time.Now())
	if err != nil {
		switch {
		case errors.Is(err, urlnorm.ErrInvalidURL):
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "that is not a valid web page address"})
		case errors.Is(err, ErrLimitReached):
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"success": false,
				"message": fmt.Sprintf("You can save up to %d pages. Delete some to save more.", MaxPerUser),
			})
		default:
			logger.Errorf("savedpage: save failed for user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not save the page"})
		}
		return
	}

	// Saving a page that is already saved is a 200, not an error: the client
	// asked for it to be saved and it is.
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, gin.H{"success": true, "created": created, "page": toResponse(page)})
}

// ListHandler handles GET /api/saved-pages.
func ListHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	pages, err := List(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("savedpage: list failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not load saved pages"})
		return
	}

	// A non-nil slice, so an empty list encodes as [] rather than null.
	out := make([]pageResponse, len(pages))
	for i, p := range pages {
		out[i] = toResponse(p)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pages": out})
}

// updateRequest uses pointers so an omitted field is distinguishable from an
// empty one: {"title": ""} clears the title, {} changes nothing.
type updateRequest struct {
	URL   *string `json:"url"`
	Title *string `json:"title"`
}

// UpdateHandler handles PATCH /api/saved-pages/:id.
func UpdateHandler(c *gin.Context) {
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}
	if req.URL == nil && req.Title == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "nothing to change: send a url or a title"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	page, err := Update(c.Request.Context(), userID, c.Param("id"), Patch{URL: req.URL, Title: req.Title})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "saved page not found"})
		case errors.Is(err, ErrDuplicate):
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "you have already saved a page with that address"})
		case errors.Is(err, urlnorm.ErrInvalidURL):
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "that is not a valid web page address"})
		default:
			logger.Errorf("savedpage: update failed for user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not update the page"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "page": toResponse(page)})
}

// DeleteHandler handles DELETE /api/saved-pages/:id.
func DeleteHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if err := Delete(c.Request.Context(), userID, c.Param("id")); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "saved page not found"})
			return
		}
		logger.Errorf("savedpage: delete failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not delete the page"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeleteAllHandler handles DELETE /api/saved-pages.
func DeleteAllHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	deleted, err := DeleteAll(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("savedpage: delete all failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not delete your saved pages"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "deleted": deleted})
}

type exportItem struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	SavedAt string `json:"savedAt"`
}

// ExportHandler handles GET /api/saved-pages/export: everything the caller
// has saved, as a downloadable JSON file. Only what the user put in (URL,
// title) and when -- no internal ids, no user id.
func ExportHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	pages, err := List(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("savedpage: export failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not export your saved pages"})
		return
	}

	items := make([]exportItem, len(pages))
	for i, p := range pages {
		items[i] = exportItem{URL: p.URL, Title: p.Title, SavedAt: p.CreatedAt.UTC().Format(time.RFC3339)}
	}
	c.Header("Content-Disposition", `attachment; filename="catglish-saved-pages.json"`)
	c.JSON(http.StatusOK, gin.H{
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"items":      items,
	})
}
