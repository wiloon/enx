package translate

import (
	"errors"

	"enx-api/dictionary"
	"enx-api/enx"
	"strings"

	"github.com/gin-gonic/gin"
)

func isSentence(raw string) bool {
	return strings.Contains(raw, " ")
}

func respondSentenceUnavailable(c *gin.Context, raw string) {
	word := enx.Word{}
	word.English = raw
	word.Key = strings.ToLower(raw)
	word.Chinese = SentenceTranslationNotice
	c.JSON(200, word)
}

// fillFromEcdict loads from ECDICT when the word is not in the local DB.
// Returns (continueHandler, filledFromEcdict).
func fillFromEcdict(c *gin.Context, word *enx.Word, userId string) (bool, bool) {
	if word.Id != "" {
		return true, false
	}

	epc, err := dictionary.Lookup(c.Request.Context(), word.English)
	if errors.Is(err, dictionary.ErrEcdictUnavailable) {
		dictionary.RespondUnavailable(c)
		return false, false
	}
	if epc == nil {
		return true, false
	}

	word.English = epc.English
	word.Key = strings.ToLower(epc.English)
	word.Chinese = epc.Chinese
	word.Pronunciation = epc.Pronunciation
	word.Save()

	userDict := enx.UserDict{}
	userDict.UserId = userId
	userDict.WordId = word.Id
	userDict.AlreadyAcquainted = word.AlreadyAcquainted
	userDict.QueryCount = 1
	userDict.Save()
	return true, true
}
