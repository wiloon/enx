package translate

import (
	"errors"
	"strings"

	"enx-api/dictionary"
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

func translateWord(c *gin.Context, raw string) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		logger.Errorf("no valid user id found in session")
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	logger.Debugf("translate word: %s, user_id: %s", raw, userId)

	if isSentence(raw) {
		respondSentenceUnavailable(c, raw)
		return
	}

	word := enx.Word{}
	word.SetEnglish(raw)

	res, err := dictionary.Resolve(c.Request.Context(), word.English, userId)
	switch {
	case errors.Is(err, dictionary.ErrEcdictUnavailable):
		dictionary.RespondUnavailable(c)
		return
	case errors.Is(err, dictionary.ErrQuotaExceeded):
		dictionary.RespondQuotaExceeded(c, userId)
		return
	case err != nil:
		// Resolve documents only the two sentinels above (ADR-018 E2); an
		// unknown error must never be passed off as "word not found" (#17).
		logger.Errorf("translate word %s: %v", word.English, err)
		c.JSON(502, gin.H{"success": false, "message": "Dictionary lookup failed"})
		return
	}

	word.Id = res.ID
	word.English = res.English
	word.Key = strings.ToLower(res.English)
	word.Chinese = res.Chinese
	word.Pronunciation = res.Pronunciation

	// Review bookkeeping needs a persisted word: nothing to count on a miss.
	if word.Id != "" {
		qc, acquainted, err := repo.RecordWordLookup(userId, word.Id)
		if err != nil {
			logger.Errorf("record lookup of %s for %s: %v", word.English, userId, err)
			word.FindQueryCount(userId)
		} else {
			word.LoadCount = qc
			word.AlreadyAcquainted = acquainted
		}
	}

	logger.Debugf("translate result: %+v", word)
	c.JSON(200, word)
}

// Translate handles GET /api/translate?word=
func Translate(c *gin.Context) {
	translateWord(c, c.Query("word"))
}

// TranslateByWord handles GET /api/word/:word
func TranslateByWord(c *gin.Context) {
	translateWord(c, c.Param("word"))
}
