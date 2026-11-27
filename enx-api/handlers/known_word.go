package handlers

import (
	"context"
	"net/http"
	"strings"

	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// KnownWordSetter is the slice of review.Service the handler uses.
type KnownWordSetter interface {
	SetKnown(ctx context.Context, userID, wordID string, known bool, source string) (queryCount int, isKnown bool, err error)
}

// KnownWordHandler serves PUT and DELETE /api/me/words/:english/known. The
// optional source query parameter says where the click came from (ADR-097).
type KnownWordHandler struct {
	words KnownWordSetter
}

func NewKnownWordHandler(words KnownWordSetter) *KnownWordHandler {
	return &KnownWordHandler{words: words}
}

// Set handles PUT: the caller already knows the word. Idempotent, so the
// extension may retry it.
func (h *KnownWordHandler) Set(c *gin.Context) { h.setKnown(c, true) }

// Clear handles DELETE: the caller is still learning the word. Idempotent, so
// the extension may retry it.
func (h *KnownWordHandler) Clear(c *gin.Context) { h.setKnown(c, false) }

// setKnown responds with the word and the caller's query count and known flag
// for it after the change.
func (h *KnownWordHandler) setKnown(c *gin.Context, known bool) {
	userId, ok := middleware.RequireUserID(c, "Invalid session")
	if !ok {
		return
	}

	english := c.Param("english")
	row := repo.GetWordByEnglish(english)
	word := enx.Word{
		Id:            row.Id,
		English:       english,
		Key:           strings.ToLower(english),
		Chinese:       row.Chinese,
		Pronunciation: row.Pronunciation,
	}

	// A word with no `words` row (e.g. one ECDICT doesn't know) has no id to
	// key a user_dicts row on. Writing one with an empty word_id would make
	// every such word share that single row, and the phantom row would count
	// towards the user's vocabulary. Nothing is lost by skipping the write:
	// no review-list entry can exist for an id-less word anyway.
	if word.Id == "" {
		c.JSON(http.StatusOK, word)
		return
	}

	qc, isKnown, err := h.words.SetKnown(c.Request.Context(), userId, word.Id, known, c.Query("source"))
	if err != nil {
		logger.Errorf("setWordKnown: set %s known=%v for %s: %v", word.English, known, userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to update the word",
		})
		return
	}
	word.LoadCount = qc
	word.Known = isKnown
	c.JSON(http.StatusOK, word)
}
