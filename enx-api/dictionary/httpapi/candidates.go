package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"enx-api/dictionary"
	"enx-api/platform/httpjson"
	"enx-api/platform/httpquery"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// CandidateReview is the admin's side of the AI candidate table
// (adapters.AICandidates in production).
type CandidateReview interface {
	ListCandidates(ctx context.Context, status dictionary.CandidateStatus, limit, offset int) ([]dictionary.Candidate, int64, error)
	ApproveCandidate(ctx context.Context, english string) (created bool, err error)
	RejectCandidate(ctx context.Context, english string) error
	UnrejectCandidate(ctx context.Context, english string) error
}

// CandidatesHandler serves the admin's AI candidate review endpoints
// (ADR-091). Mount it behind the admin middleware.
type CandidatesHandler struct {
	review CandidateReview
}

func NewCandidatesHandler(review CandidateReview) *CandidatesHandler {
	return &CandidatesHandler{review: review}
}

const (
	candidatesDefaultLimit = 50
	candidatesMaxLimit     = 200
)

type candidateJSON struct {
	English       string `json:"english"`
	Chinese       string `json:"chinese"`
	Quality       int    `json:"quality"`
	PromptVersion string `json:"promptVersion"`
	Status        string `json:"status"`
	HitCount      int    `json:"hitCount"`
	FirstHitAt    int64  `json:"firstHitAt"` // Unix milliseconds
	LastHitAt     int64  `json:"lastHitAt"`  // Unix milliseconds
}

// List handles GET /api/admin/ai-candidates?status=pending|rejected&limit&offset.
func (h *CandidatesHandler) List(c *gin.Context) {
	status := dictionary.CandidateStatus(c.DefaultQuery("status", string(dictionary.CandidatePending)))
	if status != dictionary.CandidatePending && status != dictionary.CandidateRejected {
		httpjson.Fail(c, http.StatusBadRequest, "status must be pending or rejected")
		return
	}
	limit, ok := httpquery.Int(c, "limit", candidatesDefaultLimit)
	if !ok || limit < 1 || limit > candidatesMaxLimit {
		httpjson.Fail(c, http.StatusBadRequest, "limit must be between 1 and 200")
		return
	}
	offset, ok := httpquery.Int(c, "offset", 0)
	if !ok || offset < 0 {
		httpjson.Fail(c, http.StatusBadRequest, "offset must be 0 or more")
		return
	}
	rows, total, err := h.review.ListCandidates(c.Request.Context(), status, limit, offset)
	if err != nil {
		logger.Errorf("ListCandidates: %v", err)
		httpjson.Fail(c, http.StatusInternalServerError, "failed to list AI candidate definitions")
		return
	}
	out := make([]candidateJSON, 0, len(rows))
	for _, r := range rows {
		out = append(out, candidateJSON{
			English: r.English, Chinese: r.Chinese, Quality: r.Quality,
			PromptVersion: r.PromptVersion, Status: string(r.Status), HitCount: r.HitCount,
			FirstHitAt: r.FirstHitAt.UnixMilli(), LastHitAt: r.LastHitAt.UnixMilli(),
		})
	}
	c.JSON(http.StatusOK, gin.H{"candidates": out, "total": total})
}

// Approve handles POST /api/admin/ai-candidates/:word/approve. created is
// false when words already had a live row for the word, which is left as it was.
func (h *CandidatesHandler) Approve(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	created, err := h.review.ApproveCandidate(c.Request.Context(), word)
	if h.failed(c, "ApproveCandidate", err) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "created": created})
}

// Reject handles POST /api/admin/ai-candidates/:word/reject.
func (h *CandidatesHandler) Reject(c *gin.Context) {
	err := h.review.RejectCandidate(c.Request.Context(), strings.TrimSpace(c.Param("word")))
	if h.failed(c, "RejectCandidate", err) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Unreject handles POST /api/admin/ai-candidates/:word/unreject.
func (h *CandidatesHandler) Unreject(c *gin.Context) {
	err := h.review.UnrejectCandidate(c.Request.Context(), strings.TrimSpace(c.Param("word")))
	if h.failed(c, "UnrejectCandidate", err) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// failed answers an error (404 for a missing candidate, else 500) and reports
// whether there was one.
func (h *CandidatesHandler) failed(c *gin.Context, op string, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, dictionary.ErrCandidateNotFound):
		httpjson.Fail(c, http.StatusNotFound, "AI candidate definition not found")
	default:
		logger.Errorf("%s: %v", op, err)
		httpjson.Fail(c, http.StatusInternalServerError, "failed to update the AI candidate definition")
	}
	return true
}
