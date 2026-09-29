package paragraph

import (
	"context"
	"net/http"

	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// TextWords looks up every word of a paragraph for a user: enx.TextWords in
// production.
type TextWords interface {
	In(ctx context.Context, paragraph, userID string) (map[string]enx.Word, error)
}

// Handler serves GET /api/paragraph-init.
type Handler struct {
	words TextWords
}

func NewHandler(words TextWords) *Handler {
	return &Handler{words: words}
}

// ParagraphInit handles GET /api/paragraph-init?paragraph=: the id and the
// caller's review state of every word, so the extension can underline them.
func (h *Handler) ParagraphInit(c *gin.Context) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	out, err := h.words.In(c.Request.Context(), c.Query("paragraph"), userId)
	if err != nil {
		logger.Errorf("paragraph-init for %s: %v", userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to load word states",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data": out,
	})
}
