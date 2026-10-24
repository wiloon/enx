package billing

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"enx-api/billing/conflict"
	"enx-api/billing/conflictadmin"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// ConflictAdmin is the administrator's subscription-conflict API:
// *conflictadmin.Service in production.
type ConflictAdmin interface {
	List(ctx context.Context, status string, limit, offset int) ([]conflictadmin.Conflict, error)
	Detail(ctx context.Context, subscriptionID string) (conflictadmin.Detail, error)
	Resolve(ctx context.Context, operatorID, subscriptionID string, req conflict.ResolveRequest) (conflict.Resolution, error)
}

// ConflictAdminHandler is the HTTP edge of alert.AdminSubscriptionConflictsPath
// (ADR-067 §管理员处理与邮件). Mount behind clerkAuth + RequireAdmin. The
// Stripe Subscription ID is the :id of a conflict.
type ConflictAdminHandler struct {
	conflicts ConflictAdmin
}

// NewConflictAdminHandler returns the subscription-conflict admin edge.
func NewConflictAdminHandler(conflicts ConflictAdmin) *ConflictAdminHandler {
	return &ConflictAdminHandler{conflicts: conflicts}
}

// List handles GET /api/admin/subscription-conflicts?status=&limit=&offset=,
// newest discovery first.
func (h *ConflictAdminHandler) List(c *gin.Context) {
	limit, okLimit := wholeQuery(c, "limit")
	offset, okOffset := wholeQuery(c, "offset")
	if !okLimit || !okOffset {
		conflictFailure(c, http.StatusBadRequest, "limit and offset must be whole numbers")
		return
	}
	conflicts, err := h.conflicts.List(c.Request.Context(), c.Query("status"), limit, offset)
	switch {
	case errors.Is(err, conflict.ErrInvalidStatus):
		conflictFailure(c, http.StatusBadRequest, "status must be open or resolved")
		return
	case err != nil:
		conflictUnavailable(c, "list", err)
		return
	}
	rows := make([]gin.H, len(conflicts))
	for i, cf := range conflicts {
		rows[i] = conflictJSON(cf)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "conflicts": rows})
}

// Detail handles GET /api/admin/subscription-conflicts/:id: the conflict
// with the webhook events that reference its subscription.
func (h *ConflictAdminHandler) Detail(c *gin.Context) {
	d, err := h.conflicts.Detail(c.Request.Context(), c.Param("id"))
	switch {
	case errors.Is(err, conflictadmin.ErrNotFound):
		conflictFailure(c, http.StatusNotFound, "no subscription conflict with that ID")
		return
	case err != nil:
		conflictUnavailable(c, "detail "+c.Param("id"), err)
		return
	}
	events := make([]gin.H, len(d.Events))
	for i, e := range d.Events {
		deliveries := make([]gin.H, len(e.Deliveries))
		for j, dl := range e.Deliveries {
			deliveries[j] = gin.H{"id": dl.ID, "receivedAt": rfc3339(dl.ReceivedAt)}
		}
		events[i] = gin.H{
			"eventId": e.EventID, "type": e.Type, "status": e.Status, "attempts": e.Attempts,
			"lastError": e.LastError, "deliveries": deliveries,
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "conflict": conflictJSON(d.Conflict), "events": events})
}

type resolveConflictRequest struct {
	Status string `json:"status"`
	Notes  string `json:"notes"`
}

// Resolve handles PATCH /api/admin/subscription-conflicts/:id with
// {"status":"resolved","notes":"..."}, recorded with the signed-in
// administrator's local user ID. Repeating it identically is a no-op.
func (h *ConflictAdminHandler) Resolve(c *gin.Context) {
	var req resolveConflictRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		conflictFailure(c, http.StatusBadRequest, "status and notes are required")
		return
	}
	id := c.Param("id")
	operatorID := middleware.GetUserIDFromContext(c)
	res, err := h.conflicts.Resolve(c.Request.Context(), operatorID, id, conflict.ResolveRequest{Status: req.Status, Notes: req.Notes})
	switch {
	case errors.Is(err, conflictadmin.ErrNotFound):
		conflictFailure(c, http.StatusNotFound, "no subscription conflict with that ID")
		return
	case errors.Is(err, conflict.ErrInvalidStatus):
		conflictFailure(c, http.StatusBadRequest, "status must be resolved")
		return
	case errors.Is(err, conflict.ErrBlankNotes):
		conflictFailure(c, http.StatusBadRequest, "notes are required")
		return
	case errors.Is(err, conflict.ErrResolutionDiffers):
		conflictFailure(c, http.StatusConflict, "the conflict is already resolved with different notes")
		return
	case err != nil:
		conflictUnavailable(c, "resolve "+id, err)
		return
	}
	logger.Infof("admin subscription conflicts: %s resolved by %s", id, operatorID)
	c.JSON(http.StatusOK, gin.H{"success": true, "resolution": resolutionJSON(res)})
}

func conflictJSON(cf conflictadmin.Conflict) gin.H {
	var resolution, support any
	if cf.Resolution.Status == conflict.Resolved {
		resolution = resolutionJSON(cf.Resolution)
	}
	if !cf.Support.At.IsZero() {
		support = gin.H{"message": cf.Support.Message, "sentAt": rfc3339(cf.Support.At)}
	}
	return gin.H{
		"subscriptionId":         cf.SubscriptionID,
		"acceptedSubscriptionId": cf.AcceptedSubscriptionID,
		"userId":                 cf.OwnerID,
		"customerId":             cf.CustomerID,
		"stripeStatus":           cf.StripeStatus,
		"reason":                 cf.Reason,
		"discoveredAt":           rfc3339(cf.DiscoveredAt),
		"status":                 cf.Resolution.Status,
		"resolution":             resolution,
		"supportRequest":         support,
	}
}

func resolutionJSON(r conflict.Resolution) gin.H {
	return gin.H{"status": r.Status, "resolvedBy": r.ResolverID, "resolvedAt": rfc3339(r.ResolvedAt), "notes": r.Notes}
}

func rfc3339(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// wholeQuery reads an optional integer query parameter; 0 when absent.
func wholeQuery(c *gin.Context, name string) (int, bool) {
	v := c.Query(name)
	if v == "" {
		return 0, true
	}
	n, err := strconv.Atoi(v)
	return n, err == nil
}

func conflictUnavailable(c *gin.Context, action string, err error) {
	logger.Errorf("admin subscription conflicts: %s: %v", action, err)
	conflictFailure(c, http.StatusServiceUnavailable, "subscription conflicts are unavailable right now; try again later")
}

func conflictFailure(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"success": false, "message": message})
}
