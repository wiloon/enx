package handlers

import (
	"context"
	"net/http"

	"enx-api/middleware"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// ReviewWordLister reads a user's review list: repo.ReviewWords in
// production.
type ReviewWordLister interface {
	List(ctx context.Context, userID string) ([]repo.ReviewWord, error)
}

// ReviewWordsHandler serves GET /api/me/review-words (ADR-069 Decision 1).
type ReviewWordsHandler struct {
	words ReviewWordLister
}

func NewReviewWordsHandler(words ReviewWordLister) *ReviewWordsHandler {
	return &ReviewWordsHandler{words: words}
}

// List answers the signed-in user's review list as compact pairs,
// [["word",3], ...], so the extension can underline any page without
// sending its text. An empty list is [].
func (h *ReviewWordsHandler) List(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Invalid session"})
		return
	}
	words, err := h.words.List(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("review words for %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load your review list"})
		return
	}
	out := make([][2]any, len(words))
	for i, w := range words {
		out[i] = [2]any{w.English, w.QueryCount}
	}
	c.JSON(http.StatusOK, out)
}
