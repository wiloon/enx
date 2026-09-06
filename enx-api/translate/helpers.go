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

	// dictionary.Lookup only ever returns a sentinel error (ErrEcdictUnavailable
	// / ErrQuotaExceeded) -- it fails open on quota-store and subscriber-check
	// hiccups (ADR-018 E2), so a nil epc below means the word is genuinely not
	// in ECDICT, never a swallowed lookup failure (#17). If Lookup ever gains a
	// non-sentinel error path, add a branch that surfaces it as 502 here.
	epc, err := dictionary.Lookup(c.Request.Context(), word.English, userId)
	if errors.Is(err, dictionary.ErrEcdictUnavailable) {
		dictionary.RespondUnavailable(c)
		return false, false
	}
	if errors.Is(err, dictionary.ErrQuotaExceeded) {
		dictionary.RespondQuotaExceeded(c)
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
