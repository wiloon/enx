package translate

import (
	"errors"

	"enx-api/dictionary"
	"enx-api/dictsample"
	"enx-api/enx"
	"enx-api/utils/logger"
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
		// A local cache hit still counts against the free daily quota
		// (ADR-018 B2) -- there's just no ECDICT round-trip or cache-fill
		// to do. MeterLookup only ever returns ErrQuotaExceeded.
		if err := dictionary.MeterLookup(c.Request.Context(), userId); err != nil {
			dictionary.RespondQuotaExceeded(c, userId)
			return false, false
		}
		// ADR-030 Decision 0 ②: a local hit is still a resolved lookup and
		// belongs in the denominator -- without it the measured miss rate
		// would be the miss rate of *new* words only, which is much higher
		// than the rate a user actually experiences.
		dictsample.Word(word.English, dictsample.SourceLocal)
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
		dictionary.RespondQuotaExceeded(c, userId)
		return false, false
	}
	if epc == nil {
		return true, false
	}

	word.English = epc.English
	word.Key = strings.ToLower(epc.English)
	word.Chinese = epc.Chinese
	word.Pronunciation = epc.Pronunciation
	if err := word.Save(); err != nil {
		// words.english is UNIQUE: a concurrent lookup of the same new word
		// most likely inserted it first, so reuse that row.
		word.FindId()
		if word.Id == "" {
			// Still answer with the ECDICT result; just skip the user_dicts
			// bookkeeping, which needs a persisted word id.
			logger.Errorf("word not persisted, skip user dict: %s, error: %v", word.English, err)
			return true, true
		}
	}

	userDict := enx.UserDict{}
	userDict.UserId = userId
	userDict.WordId = word.Id
	userDict.AlreadyAcquainted = word.AlreadyAcquainted
	userDict.QueryCount = 1
	userDict.Save()
	return true, true
}
