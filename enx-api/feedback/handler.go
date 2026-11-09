package feedback

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"enx-api/middleware"
	"enx-api/utils/logger"
)

// Handler serves user feedback over HTTP (ADR-076).
//
// Not on the metered path: it looks up no words, calls no model and touches
// no credits, so it sits outside ADR-018's single metering seam (same as the
// stats and admin endpoints).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

type submitRequest struct {
	Kind    Kind            `json:"kind"`
	URL     string          `json:"url"`
	Text    *string         `json:"text"`
	Context json.RawMessage `json:"context"`
	Details json.RawMessage `json:"details"`
}

// Submit handles POST /api/feedback. A repeat is a 200 with recorded:false,
// so the client can treat "already sent" as done.
func (h *Handler) Submit(c *gin.Context) {
	var req submitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}
	userID := middleware.GetUserIDFromContext(c)
	recorded, err := h.svc.Submit(c.Request.Context(), userID, Submission(req))
	switch {
	case errors.Is(err, ErrInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
	case errors.Is(err, ErrDailyLimit):
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"code":    "feedback_limit_exceeded",
			"message": "Daily feedback limit reached. Please try again tomorrow.",
		})
	case err != nil:
		logger.Errorf("feedback: submit failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Could not send the feedback. Please try again."})
	default:
		c.JSON(http.StatusOK, gin.H{"success": true, "recorded": recorded})
	}
}

// List handles GET /api/admin/feedback?kind=&status=&limit=&offset=.
// Mount behind clerkAuth + RequireAdmin.
func (h *Handler) List(c *gin.Context) {
	limit, okLimit := intQuery(c, "limit", DefaultListLimit)
	offset, okOffset := intQuery(c, "offset", 0)
	if !okLimit || !okOffset {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "limit and offset must be whole numbers"})
		return
	}
	page, err := h.svc.List(c.Request.Context(), ListQuery{
		Kind: Kind(c.Query("kind")), Status: Status(c.Query("status")), Limit: limit, Offset: offset,
	})
	if errors.Is(err, ErrInvalid) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err != nil {
		logger.Errorf("feedback: list failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not list feedback"})
		return
	}
	items := make([]gin.H, len(page.Records))
	for i, r := range page.Records {
		items[i] = gin.H{
			"id": r.ID, "userId": r.UserID, "kind": r.Kind, "url": r.URL, "host": r.Host, "text": r.Text,
			"context": r.Context, "details": r.Details, "status": r.Status, "createdAt": r.CreatedAt.UnixMilli(),
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "feedback": items, "nextOffset": page.NextOffset})
}

// Resolve handles PATCH /api/admin/feedback/:id with {"status":"resolved"},
// the one transition there is. Mount behind clerkAuth + RequireAdmin.
func (h *Handler) Resolve(c *gin.Context) {
	var req struct {
		Status Status `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Status != StatusResolved {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": `status must be "resolved"`})
		return
	}
	err := h.svc.Resolve(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no such feedback"})
		return
	}
	if err != nil {
		logger.Errorf("feedback: resolve %s: %v", c.Param("id"), err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not resolve the feedback"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// intQuery reads an optional integer query parameter, def when absent.
func intQuery(c *gin.Context, name string, def int) (int, bool) {
	v, ok := c.GetQuery(name)
	if !ok {
		return def, true
	}
	n, err := strconv.Atoi(v)
	return n, err == nil
}
