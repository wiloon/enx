// Package httpapi serves the dictionary domain over HTTP.
package httpapi

import (
	"context"
	"errors"
	"net/http"

	"enx-api/dictionary"
	"enx-api/middleware"
	"enx-api/platform/httpjson"
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
	entries EntriesLookup
	tiers   dictionary.QuotaTierSource
}

func NewHandler(entries EntriesLookup, tiers dictionary.QuotaTierSource) *Handler {
	return &Handler{entries: entries, tiers: tiers}
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
	// Omitted only when the user's explanation language could not be read.
	ExplanationLanguage dictionary.Language `json:",omitempty"`
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
	*englishJSON
}

// englishJSON is what a word explained in English carries besides
// definitionJSON, whose Chinese and Pronunciation are then empty (ADR-098).
type englishJSON struct {
	Senses          []senseJSON
	LemmaNote       string `json:",omitempty"`
	PronunciationUS string `json:",omitempty"`
	PronunciationUK string `json:",omitempty"`
}

type senseJSON struct {
	Pos     string `json:"pos"`
	Gloss   string `json:"gloss"`
	Example string `json:"example,omitempty"`
}

// Entries handles QUERY /api/dictionary/entries (the default) and POST
// /api/dictionary/entries/query (the fallback for networks that reject
// QUERY, ADR-041 C): the definitions of up to 100 words in a JSON body
// {"words": [...]}, answered as an array in the order first named (ADR-079
// Decision 1). It charges the daily lookup quota once for the distinct
// words and writes no lookup event and no query count, so it may be
// retried.
func (h *Handler) Entries(c *gin.Context) {
	userID, ok := middleware.RequireUserID(c, "Invalid session")
	if !ok {
		return
	}
	// RFC 10008: fail a request whose Content-Type is missing or does not
	// match its content.
	if c.ContentType() != "application/json" {
		httpjson.Fail(c, http.StatusUnsupportedMediaType,

			"Content-Type must be application/json")

		return
	}
	var req entriesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpjson.Fail(c, http.StatusBadRequest, "Invalid request body")
		return
	}

	results, err := h.entries.Lookup(c.Request.Context(), userID, req.Words)
	switch {
	case errors.Is(err, dictionary.ErrInvalidBatch):
		httpjson.Fail(c, http.StatusBadRequest,

			"Send 1 to 100 single words in \"words\".")

		return
	case errors.Is(err, dictionary.ErrQuotaExceeded):
		RespondQuotaExceeded(c, userID, h.tiers)
		return
	case err != nil:
		logger.Errorf("dictionary entries for %s: %v", userID, err)
		httpjson.Fail(c, http.StatusInternalServerError, "Dictionary lookup failed")
		return
	}

	body := make([]entryJSON, len(results))
	for i, r := range results {
		body[i] = toEntryJSON(r)
	}
	c.Header("Accept-Query", "application/json")
	c.JSON(http.StatusOK, body)
}

func toEntryJSON(r dictionary.EntryResult) entryJSON {
	body := entryJSON{Word: r.Word, Status: r.Status, ExplanationLanguage: r.Language, AIFallback: r.AIFallback}
	if r.Status == dictionary.EntryFound {
		body.definitionJSON = &definitionJSON{
			Id:            r.Result.ID,
			English:       r.Result.English,
			Pronunciation: r.Result.Pronunciation,
			Chinese:       r.Result.Chinese,
			Origin:        r.Result.Origin,
			Source:        r.Result.Source,
			englishJSON:   toEnglishJSON(r.Result.Definition),
		}
	}
	return body
}

func toEnglishJSON(d *dictionary.EnglishDefinition) *englishJSON {
	if d == nil {
		return nil
	}
	body := &englishJSON{
		Senses:          make([]senseJSON, len(d.Senses)),
		LemmaNote:       d.LemmaNote,
		PronunciationUS: d.PronunciationUS,
		PronunciationUK: d.PronunciationUK,
	}
	for i, s := range d.Senses {
		body.Senses[i] = senseJSON{Pos: s.POS, Gloss: s.Gloss, Example: s.Example}
	}
	return body
}
