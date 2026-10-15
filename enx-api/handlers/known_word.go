package handlers

import (
	"net/http"
	"strings"

	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// MarkWord handles POST /api/mark: toggle whether the caller already knows a
// word. The response is the word with its review state after the toggle.
func MarkWord(c *gin.Context) {
	word := enx.Word{}
	if err := c.BindJSON(&word); err != nil {
		logger.Errorf("MarkWord: bind JSON: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request body",
		})
		return
	}
	word.Key = strings.ToLower(word.English)

	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	row := repo.GetWordByEnglish(word.English)
	word.Id = row.Id
	word.Chinese = row.Chinese
	word.Pronunciation = row.Pronunciation

	// A word with no `words` row (e.g. one ECDICT doesn't know) has no id to
	// key a user_dicts row on. Writing one with an empty word_id would make
	// every such word share that single row -- marking a second one toggled
	// the first back off -- and the phantom row would count towards the
	// user's vocabulary. Nothing is lost by skipping the write: paragraph-init
	// never reads acquainted state for an id-less word anyway.
	if word.Id == "" {
		c.JSON(http.StatusOK, word)
		return
	}

	qc, acquainted, err := repo.ToggleAcquainted(userId, word.Id)
	if err != nil {
		logger.Errorf("MarkWord: toggle %s for %s: %v", word.English, userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to mark word",
		})
		return
	}
	word.LoadCount = qc
	word.AlreadyAcquainted = acquainted
	c.JSON(http.StatusOK, word)
}
