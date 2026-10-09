package translate

import (
	"errors"
	"net/http"

	"enx-api/dictionary"
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

type aiWordRequest struct {
	Word string `json:"word"`
}

// AIWord handles POST /api/dictionary/ai-word, the second request of the AI
// word fallback (ADR-045): the client sends it after a lookup missed and told
// it the fallback is on. It answers 200 {"found": true, "word": {...}} with
// the same word payload as a lookup, or 200 {"found": false, ...} when the AI
// has no definition; everything else is a status code and a stable "code".
//
// The lookup request already counted against the daily lookup quota, so this
// one does not.
func (h *Handler) AIWord(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Invalid session"})
		return
	}
	if h.ai == nil {
		respondAIError(c, dictionary.ErrAIUnavailable)
		return
	}
	var req aiWordRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_word", "message": "A word is required."})
		return
	}

	// Normalised exactly as the lookup that missed normalised it, so both
	// requests mean the same words row.
	word := enx.Word{}
	word.SetEnglish(req.Word)

	res, err := h.ai.DefineWithAI(c.Request.Context(), word.English, userID)
	if err != nil {
		respondAIError(c, err)
		return
	}

	switch res.Source {
	case dictionary.SourceAI, dictionary.SourceLocal, dictionary.SourceEcdict:
	default:
		// The AI had no definition, or the dictionary could not answer.
		c.JSON(http.StatusOK, gin.H{"found": false, "reason": "no_definition"})
		return
	}

	word.Id = res.ID
	word.English = res.English
	word.Chinese = res.Chinese
	word.Pronunciation = res.Pronunciation
	word.Origin = string(res.Origin)

	// Like any lookup, a word with a row joins the user's vocabulary; one the
	// AI was not confident enough to store has no row and does not.
	if word.Id != "" {
		qc, acquainted, err := h.reviews.RecordWordLookup(userID, word.Id)
		if err != nil {
			logger.Errorf("record AI lookup of %s for %s: %v", word.English, userID, err)
		} else {
			word.LoadCount = qc
			word.AlreadyAcquainted = acquainted
		}
	}
	c.JSON(http.StatusOK, gin.H{"found": true, "word": word})
}

// respondAIError maps the AI fallback's errors to a status and a stable code.
// The messages are shown to users, so they are plain English and never carry
// an underlying error.
func respondAIError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, dictionary.ErrInvalidWord):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_word", "message": "That is not a word the AI lookup can define."})
	case errors.Is(err, dictionary.ErrNotEntitled):
		c.JSON(http.StatusForbidden, gin.H{"success": false, "code": "not_entitled", "message": "AI lookup is available with a subscription or a credit balance."})
	case errors.Is(err, dictionary.ErrInsufficientCredit):
		c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "code": "insufficient_credit", "message": "Insufficient credit. Please add credit or subscribe."})
	case errors.Is(err, dictionary.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "rate_limited", "message": "Too many AI lookups. Please try again in a moment."})
	case errors.Is(err, dictionary.ErrTrialLimitedPerDay):
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "trial_limit_day", "message": "You've reached today's trial limit. Try again tomorrow, or subscribe for more."})
	case errors.Is(err, dictionary.ErrTrialLimitedPerMinute):
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "trial_limit_minute", "message": "Too many requests. Please wait a minute and try again."})
	case errors.Is(err, dictionary.ErrAIUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "ai_unavailable", "message": "AI lookup is not available right now."})
	case errors.Is(err, dictionary.ErrEcdictUnavailable):
		dictionary.RespondUnavailable(c)
	case errors.Is(err, dictionary.ErrAIFailed):
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "code": "ai_failed", "message": "AI lookup failed. Please try again."})
	default:
		logger.Errorf("AI word lookup: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "code": "ai_failed", "message": "AI lookup failed. Please try again."})
	}
}
