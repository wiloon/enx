package handlers

import (
	"context"
	"errors"
	"net/http"

	"enx-api/dictionary"
	dictionaryhttp "enx-api/dictionary/httpapi"
	"enx-api/middleware"
	"enx-api/platform/httpjson"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// wordLookupRequest is the body. Older extensions also send fromCache,
// which no longer means anything (ADR-079 Decision 7) and is ignored.
type wordLookupRequest struct {
	WordID string `json:"wordId"`
	// Source is where the lookup came from (ADR-097 Decision 4). It is any
	// type so that a value the client gets wrong never fails the lookup.
	Source any `json:"source"`
}

// WordLookupRecorder is the slice of dictionary.WordLookups the handler uses.
type WordLookupRecorder interface {
	Record(ctx context.Context, userID, wordID, source string) (queryCount int, known bool, err error)
}

// WordLookupHandler serves POST /api/me/word-lookups.
type WordLookupHandler struct {
	lookups WordLookupRecorder
	tiers   dictionary.QuotaTierSource

	languages dictionary.ExplanationLanguages // nil: the response names none
}

func (h *WordLookupHandler) WithQuotaTiers(tiers dictionary.QuotaTierSource) *WordLookupHandler {
	h.tiers = tiers
	return h
}

func NewWordLookupHandlerWithQuotaTiers(lookups WordLookupRecorder, tiers dictionary.QuotaTierSource) *WordLookupHandler {
	return &WordLookupHandler{lookups: lookups, tiers: tiers}
}

// WithExplanationLanguages adds the user's explanation language to the
// response: a client answering from its cache sends no definitions request,
// so this is how it learns of a change (ADR-098 Decision 8).
func (h *WordLookupHandler) WithExplanationLanguages(languages dictionary.ExplanationLanguages) *WordLookupHandler {
	h.languages = languages
	return h
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
	userId, ok := middleware.RequireUserID(c, "Invalid session")
	if !ok {
		return
	}

	var req wordLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.WordID == "" {
		httpjson.Fail(c, http.StatusBadRequest, "A word id is required.")
		return
	}

	source, _ := req.Source.(string)
	qc, known, err := h.lookups.Record(c.Request.Context(), userId, req.WordID, source)
	switch {
	case errors.Is(err, dictionary.ErrWordNotFound):
		httpjson.Fail(c, http.StatusNotFound, "Word not found")
		return
	case errors.Is(err, dictionary.ErrQuotaExceeded):
		dictionaryhttp.RespondQuotaExceeded(c, userId, h.tiers)
		return
	case err != nil:
		logger.Errorf("RecordWordLookup: record %s for %s: %v", req.WordID, userId, err)
		httpjson.Fail(c, http.StatusInternalServerError, "Failed to record the lookup")
		return
	}
	body := gin.H{"queryCount": qc, "known": known}
	if h.languages != nil {
		// The lookup is recorded whether or not the language can be read.
		if lang, err := h.languages.ExplanationLanguage(c.Request.Context(), userId); err != nil {
			logger.Warnf("RecordWordLookup: explanation language read failed for %s: %v", userId, err)
		} else {
			body["explanationLanguage"] = lang
		}
	}
	c.JSON(http.StatusOK, body)
}
