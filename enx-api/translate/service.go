package translate

import (
	"context"
	"errors"
	"strings"

	"enx-api/dictionary"
	"enx-api/enx"
	"enx-api/metrics"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// Resolver resolves a word lookup: dictionary.Service in production.
type Resolver interface {
	Resolve(ctx context.Context, english, userID string) (dictionary.Result, error)
}

// ReviewLog records a user's lookup of a word for the review system:
// repo.ReviewLog in production.
type ReviewLog interface {
	RecordWordLookup(userID, wordID string) (queryCount int, alreadyAcquainted int, err error)
}

// AIDefiner defines a word the dictionaries lack: dictionary.Service in
// production (ADR-045).
type AIDefiner interface {
	DefineWithAI(ctx context.Context, english, userID string) (dictionary.Result, error)
}

// AIPolicy says what the AI fallback offers a user: adapters.AIPolicy in
// production.
type AIPolicy interface {
	Fallback(ctx context.Context, userID string) (canUse, auto bool)
}

// Handler serves the word lookup endpoints.
type Handler struct {
	dict    Resolver
	reviews ReviewLog
	ai      AIDefiner
	policy  AIPolicy
}

func NewHandler(dict Resolver, reviews ReviewLog) *Handler {
	return &Handler{dict: dict, reviews: reviews}
}

// WithAI sets up the AI word fallback: ai answers POST /api/dictionary/ai-word
// and policy decides what a lookup that found nothing offers the user. Without
// it the lookup response says nothing about AI and the endpoint is not served.
func (h *Handler) WithAI(ai AIDefiner, policy AIPolicy) *Handler {
	h.ai, h.policy = ai, policy
	return h
}

// Translate handles GET /api/translate?word=
func (h *Handler) Translate(c *gin.Context) {
	h.translateWord(c, c.Query("word"))
}

// TranslateByWord handles GET /api/word/:word
func (h *Handler) TranslateByWord(c *gin.Context) {
	h.translateWord(c, c.Param("word"))
}

func (h *Handler) translateWord(c *gin.Context, raw string) {
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

	res, err := h.dict.Resolve(c.Request.Context(), word.English, userId)
	switch {
	case errors.Is(err, dictionary.ErrEcdictUnavailable):
		dictionary.RespondUnavailable(c)
		return
	case errors.Is(err, dictionary.ErrQuotaExceeded):
		dictionary.RespondQuotaExceeded(c, userId)
		return
	case err != nil:
		// Only the two sentinels above mean something to the client; any
		// other error must never be passed off as "word not found" (#17).
		logger.Errorf("translate word %s: %v", word.English, err)
		c.JSON(502, gin.H{"success": false, "message": "Dictionary lookup failed"})
		return
	}

	// ADR-040: the metrics middleware records this request's latency under
	// the source that answered it.
	c.Set(metrics.LookupSourceKey, string(res.Source))

	word.Id = res.ID
	word.English = res.English
	word.Key = strings.ToLower(res.English)
	word.Chinese = res.Chinese
	word.Pronunciation = res.Pronunciation
	word.Origin = string(res.Origin)

	// Review bookkeeping needs a persisted word: nothing to count on a miss.
	if word.Id != "" {
		qc, acquainted, err := h.reviews.RecordWordLookup(userId, word.Id)
		if err != nil {
			// The definition is still worth answering with; the counts
			// stay at zero for this response.
			logger.Errorf("record lookup of %s for %s: %v", word.English, userId, err)
		} else {
			word.LoadCount = qc
			word.AlreadyAcquainted = acquainted
		}
	}

	// A lookup that found nothing tells the client what the AI fallback
	// offers this user, so it can run it, offer it, or point at billing.
	if res.Source == dictionary.SourceMiss && h.policy != nil {
		canUse, auto := h.policy.Fallback(c.Request.Context(), userId)
		word.AIFallback = &enx.AIFallback{CanUse: canUse, Auto: auto}
	}

	logger.Debugf("translate result: %+v", word)
	c.JSON(200, word)
}
