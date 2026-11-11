package handlers

import (
	"context"
	"errors"
	"net/http"

	"enx-api/dictionary"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// wordLookupRequest is the body. Older extensions also send fromCache,
// which no longer means anything (ADR-079 Decision 7) and is ignored.
type wordLookupRequest struct {
	WordID string `json:"wordId"`
}

// WordLookupRecorder is the slice of dictionary.WordLookups the handler uses.
type WordLookupRecorder interface {
	Record(ctx context.Context, userID, wordID string) (queryCount int, known bool, err error)
}

// WordLookupHandler serves POST /api/me/word-lookups.
type WordLookupHandler struct {
	lookups       WordLookupRecorder
	subscriptions dictionary.Subscriptions
}

func NewWordLookupHandler(lookups WordLookupRecorder) *WordLookupHandler {
	return NewWordLookupHandlerWithSubscriptions(lookups, entadapters.Billing{})
}

func (h *WordLookupHandler) WithSubscriptions(subs dictionary.Subscriptions) *WordLookupHandler {
	h.subscriptions = subs
	return h
}

func NewWordLookupHandlerWithSubscriptions(lookups WordLookupRecorder, subs dictionary.Subscriptions) *WordLookupHandler {
	return &WordLookupHandler{lookups: lookups, subscriptions: subs}
}

// Record handles POST /api/me/word-lookups: the caller looked up the word
// with this id, so its query count goes up by one and it leaves "known"
// (ADR-059 Decision 3). The extension sends it once per click-to-lookup,
// whether the definition came from the server or its local dictionary
// cache.
//
// It is the only writer of the query count and of lookup events (ADR-079
// Decision 1): it charges one against the daily quota, answering the
// lookup's 429 when the quota is used up. It is not idempotent and not
// retried; a lost one leaves the count one short.
func (h *WordLookupHandler) Record(c *gin.Context) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	var req wordLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.WordID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "A word id is required."})
		return
	}

	qc, known, err := h.lookups.Record(c.Request.Context(), userId, req.WordID)
	switch {
	case errors.Is(err, dictionary.ErrWordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Word not found"})
		return
	case errors.Is(err, dictionary.ErrQuotaExceeded):
		dictionary.RespondQuotaExceededWithSubscriptions(c, userId, h.subscriptions)
		return
	case err != nil:
		logger.Errorf("RecordWordLookup: record %s for %s: %v", req.WordID, userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to record the lookup"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"queryCount": qc, "known": known})
}
