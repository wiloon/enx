// Package httpapi serves the dictionary domain over HTTP.
package httpapi

import (
	"context"
	"errors"
	"net/http"

	"enx-api/dictionary"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// EntriesLookup reads a batch of definitions: dictionary.Entries in
// production.
type EntriesLookup interface {
	Lookup(ctx context.Context, userID string, words []string) ([]dictionary.EntryResult, error)
}

// Handler serves the batch definitions endpoint.
type Handler struct {
	entries       EntriesLookup
	subscriptions dictionary.Subscriptions
}

func NewHandler(entries EntriesLookup, subs dictionary.Subscriptions) *Handler {
	return &Handler{entries: entries, subscriptions: subs}
}

type entriesRequest struct {
	Words []string `json:"words"`
}

// entryJSON is one result. A found word carries the dictionary fields the
// clients' local dictionary cache keeps (ADR-061 Decision 1), with Id left
// out when the definition could not be cached; the other statuses carry
// none.
type entryJSON struct {
	Word   string
	Status dictionary.EntryStatus
	*definitionJSON
	AIFallback *dictionary.AIFallbackOffer `json:",omitempty"`
}

type definitionJSON struct {
	Id            string `json:",omitempty"`
	English       string
	Pronunciation string
	Chinese       string
	WordType      int
	Origin        dictionary.Origin
	Source        dictionary.Source
}

// Entries handles QUERY /api/dictionary/entries (the default) and POST
// /api/dictionary/entries/query (the fallback for networks that reject
// QUERY, ADR-041 C): the definitions of up to 100 words in a JSON body
// {"words": [...]}, answered as an array in the order first named (ADR-079
// Decision 1). It charges the daily lookup quota once for the distinct
// words and writes no lookup event and no query count, so it may be
// retried.
func (h *Handler) Entries(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Invalid session"})
		return
	}
	// RFC 10008: fail a request whose Content-Type is missing or does not
	// match its content.
	if c.ContentType() != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"success": false,
			"message": "Content-Type must be application/json",
		})
		return
	}
	var req entriesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid request body"})
		return
	}

	results, err := h.entries.Lookup(c.Request.Context(), userID, req.Words)
	switch {
	case errors.Is(err, dictionary.ErrInvalidBatch):
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Send 1 to 100 single words in \"words\".",
		})
		return
	case errors.Is(err, dictionary.ErrQuotaExceeded):
		dictionary.RespondQuotaExceededWithSubscriptions(c, userID, h.subscriptions)
		return
	case err != nil:
		logger.Errorf("dictionary entries for %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Dictionary lookup failed"})
		return
	}

	body := make([]entryJSON, len(results))
	for i, r := range results {
		body[i] = entryJSON{Word: r.Word, Status: r.Status, AIFallback: r.AIFallback}
		if r.Status == dictionary.EntryFound {
			body[i].definitionJSON = &definitionJSON{
				Id:            r.Result.ID,
				English:       r.Result.English,
				Pronunciation: r.Result.Pronunciation,
				Chinese:       r.Result.Chinese,
				Origin:        r.Result.Origin,
				Source:        r.Result.Source,
			}
		}
	}
	c.Header("Accept-Query", "application/json")
	c.JSON(http.StatusOK, body)
}
