// Package httpapi serves the review session and answers (ADR-097).
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"enx-api/dictionary"
	"enx-api/middleware"
	"enx-api/review"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// Service is the slice of review.Service the handler uses.
type Service interface {
	Candidates(ctx context.Context, userID string, limit int) ([]review.Candidate, error)
	Answer(ctx context.Context, userID, wordID string, rating review.Rating) (due time.Time, err error)
}

// Resolver turns a candidate into a definition without metering.
type Resolver interface {
	Resolve(ctx context.Context, english, userID string, lang dictionary.Language) (dictionary.Result, error)
}

// Handler serves GET /api/me/review/session and POST /api/me/review/answers.
type Handler struct {
	svc       Service
	resolve   Resolver
	languages dictionary.ExplanationLanguages
	tiers     dictionary.QuotaTierSource
}

// NewHandler wires the review HTTP API. languages and tiers may be nil only
// in tests that replace them before serving.
func NewHandler(svc Service, resolve Resolver, languages dictionary.ExplanationLanguages, tiers dictionary.QuotaTierSource) *Handler {
	return &Handler{svc: svc, resolve: resolve, languages: languages, tiers: tiers}
}

type cardJSON struct {
	WordID        string `json:"wordId"`
	English       string `json:"english"`
	Chinese       string `json:"chinese"`
	Pronunciation string `json:"pronunciation"`
}

// Session returns up to 20 due-or-new cards with definitions in the user's
// explanation language. Paid tier only (ADR-093); TierUnknown is allowed.
func (h *Handler) Session(c *gin.Context) {
	userID, ok := middleware.RequireUserID(c, "Unauthorized")
	if !ok {
		return
	}
	if !h.requirePaid(c, userID) {
		return
	}
	lang, ok := h.explanationLanguage(c, userID)
	if !ok {
		return
	}
	candidates, err := h.svc.Candidates(c.Request.Context(), userID, review.SessionLimit)
	if err != nil {
		logger.Errorf("review session: list candidates for %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Review is temporarily unavailable."})
		return
	}
	cards := make([]cardJSON, 0, len(candidates))
	for _, cand := range candidates {
		res, err := h.resolve.Resolve(c.Request.Context(), cand.English, userID, lang)
		if err != nil || !hasDefinition(res) {
			continue
		}
		cards = append(cards, cardJSON{
			WordID:        cand.WordID,
			English:       cand.English,
			Chinese:       res.Chinese,
			Pronunciation: res.Pronunciation,
		})
	}
	c.JSON(http.StatusOK, gin.H{"cards": cards})
}

type answerBody struct {
	WordID string `json:"wordId"`
	Rating string `json:"rating"`
}

// Answer records one FSRS rating for a session candidate.
func (h *Handler) Answer(c *gin.Context) {
	userID, ok := middleware.RequireUserID(c, "Unauthorized")
	if !ok {
		return
	}
	if !h.requirePaid(c, userID) {
		return
	}
	var body answerBody
	if err := c.ShouldBindJSON(&body); err != nil || body.WordID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_body", "message": "Send wordId and rating."})
		return
	}
	rating, ok := review.ParseRating(body.Rating)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_rating", "message": "Rating must be again, hard, good or easy."})
		return
	}
	due, err := h.svc.Answer(c.Request.Context(), userID, body.WordID, rating)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"wordId": body.WordID, "due": due.UTC().Format(time.RFC3339)})
	case errors.Is(err, review.ErrWordGone):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "code": "not_found", "message": "That word was not found."})
	case errors.Is(err, review.ErrNotDue):
		c.JSON(http.StatusConflict, gin.H{"success": false, "code": "not_due", "message": "That word is not due for review."})
	default:
		logger.Errorf("review answer: %s for %s: %v", body.WordID, userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Review is temporarily unavailable."})
	}
}

func (h *Handler) requirePaid(c *gin.Context, userID string) bool {
	tier, _ := dictionary.QuotaTierOf(c.Request.Context(), h.tiers, userID)
	if tier != dictionary.TierFree {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{
		"success": false,
		"code":    "not_entitled",
		"message": "Review is available with a subscription or a credit balance.",
	})
	return false
}

func (h *Handler) explanationLanguage(c *gin.Context, userID string) (dictionary.Language, bool) {
	lang, err := h.languages.ExplanationLanguage(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("review session: explanation language for %s: %v", userID, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"message": "Review is temporarily unavailable.",
		})
		return "", false
	}
	return lang, true
}

func hasDefinition(res dictionary.Result) bool {
	switch res.Source {
	case dictionary.SourceMiss, dictionary.SourceTimeout, dictionary.SourceError, "":
		return false
	}
	return res.ID != "" || res.Chinese != "" || res.Pronunciation != "" || res.Definition != nil
}
