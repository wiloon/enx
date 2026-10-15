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

// SetWordKnown handles PUT /api/me/words/:english/known: the caller already
// knows the word. Idempotent, so the extension may retry it.
func SetWordKnown(c *gin.Context) { setWordKnown(c, true) }

// ClearWordKnown handles DELETE /api/me/words/:english/known: the caller is
// still learning the word. Idempotent, so the extension may retry it.
func ClearWordKnown(c *gin.Context) { setWordKnown(c, false) }

// setWordKnown responds with the word and the caller's review state for it
// after the change.
func setWordKnown(c *gin.Context, known bool) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid session",
		})
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
	// paragraph-init never reads acquainted state for an id-less word anyway.
	if word.Id == "" {
		c.JSON(http.StatusOK, word)
		return
	}

	qc, acquainted, err := repo.SetAcquainted(userId, word.Id, known)
	if err != nil {
		logger.Errorf("setWordKnown: set %s known=%v for %s: %v", word.English, known, userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to update the word",
		})
		return
	}
	word.LoadCount = qc
	word.AlreadyAcquainted = acquainted
	c.JSON(http.StatusOK, word)
}
