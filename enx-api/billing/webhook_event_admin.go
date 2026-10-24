package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"enx-api/billing/eventadmin"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// WebhookEventAdmin is the administrator's webhook event API:
// *eventadmin.Service in production.
type WebhookEventAdmin interface {
	List(ctx context.Context, status string, limit, offset int) ([]eventadmin.Event, error)
	Detail(ctx context.Context, eventID string) (eventadmin.Detail, error)
	Retry(ctx context.Context, eventID string) (eventadmin.Event, error)
}

// WebhookEventAdminHandler is the HTTP edge of alert.AdminWebhookEventsPath
// (ADR-067 §管理员处理与邮件). Mount behind clerkAuth + RequireAdmin. The
// Stripe Event ID is the :id of an event.
type WebhookEventAdminHandler struct {
	events WebhookEventAdmin
}

// NewWebhookEventAdminHandler returns the webhook event admin edge.
func NewWebhookEventAdminHandler(events WebhookEventAdmin) *WebhookEventAdminHandler {
	return &WebhookEventAdminHandler{events: events}
}

// List handles GET /api/admin/webhook-events?status=&limit=&offset=, newest
// receipt first; without a status, the events that need attention.
func (h *WebhookEventAdminHandler) List(c *gin.Context) {
	limit, okLimit := wholeQuery(c, "limit")
	offset, okOffset := wholeQuery(c, "offset")
	if !okLimit || !okOffset {
		conflictFailure(c, http.StatusBadRequest, "limit and offset must be whole numbers")
		return
	}
	events, err := h.events.List(c.Request.Context(), c.Query("status"), limit, offset)
	switch {
	case errors.Is(err, eventadmin.ErrInvalidStatus):
		conflictFailure(c, http.StatusBadRequest, "status must be pending, processing, waiting_dependency, processed, needs_attention or ignored")
		return
	case err != nil:
		webhookEventsUnavailable(c, "list", err)
		return
	}
	rows := make([]gin.H, len(events))
	for i, e := range events {
		rows[i] = webhookEventJSON(e)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": rows})
}

// Detail handles GET /api/admin/webhook-events/:id: the event with every
// delivery and its original payload, which may hold personal data and is
// never logged.
func (h *WebhookEventAdminHandler) Detail(c *gin.Context) {
	id := c.Param("id")
	d, err := h.events.Detail(c.Request.Context(), id)
	switch {
	case errors.Is(err, eventadmin.ErrNotFound):
		conflictFailure(c, http.StatusNotFound, "no webhook event with that ID")
		return
	case err != nil:
		webhookEventsUnavailable(c, "detail "+id, err)
		return
	}
	deliveries := make([]gin.H, len(d.Deliveries))
	for i, dl := range d.Deliveries {
		deliveries[i] = gin.H{"id": dl.ID, "receivedAt": rfc3339(dl.ReceivedAt)}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "event": webhookEventJSON(d.Event), "deliveries": deliveries, "payload": json.RawMessage(d.Payload),
	})
}

// Retry handles POST /api/admin/webhook-events/:id/retry: an event that
// needs attention is requeued with its idempotency keys, dependency-wait
// clock and alert kept.
func (h *WebhookEventAdminHandler) Retry(c *gin.Context) {
	id := c.Param("id")
	e, err := h.events.Retry(c.Request.Context(), id)
	switch {
	case errors.Is(err, eventadmin.ErrNotFound):
		conflictFailure(c, http.StatusNotFound, "no webhook event with that ID")
		return
	case errors.Is(err, eventadmin.ErrNotRetryable):
		conflictFailure(c, http.StatusConflict, "only an event that needs attention can be retried")
		return
	case err != nil:
		webhookEventsUnavailable(c, "retry "+id, err)
		return
	}
	logger.Infof("admin webhook events: %s retried by %s", id, middleware.GetUserIDFromContext(c))
	c.JSON(http.StatusOK, gin.H{"success": true, "event": webhookEventJSON(e)})
}

func webhookEventJSON(e eventadmin.Event) gin.H {
	t := e.Task
	var alertJSON any
	if t.Alert.State != "" {
		alertJSON = gin.H{"state": t.Alert.State, "attempts": t.Alert.Attempts, "lastError": t.Alert.LastError, "sentAt": optionalRFC3339(t.Alert.SentAt)}
	}
	return gin.H{
		"eventId":       e.Scope.EventID,
		"accountId":     e.Scope.AccountID,
		"livemode":      e.Scope.Livemode,
		"type":          t.Type,
		"apiVersion":    e.APIVersion,
		"created":       rfc3339(e.Created),
		"status":        t.Status,
		"attempts":      t.Attempts,
		"lastError":     t.LastError,
		"firstWaitAt":   optionalRFC3339(t.FirstWaitAt),
		"nextAttemptAt": optionalRFC3339(t.NextAttemptAt),
		"completedAt":   optionalRFC3339(t.CompletedAt),
		"references": gin.H{
			"subscriptionId":    e.Refs.SubscriptionID,
			"customerId":        e.Refs.CustomerID,
			"checkoutSessionId": e.Refs.CheckoutSessionID,
			"invoiceId":         e.Refs.InvoiceID,
			"paymentIntentId":   e.Refs.PaymentIntentID,
			"chargeId":          e.Refs.ChargeID,
		},
		"alert": alertJSON,
	}
}

// optionalRFC3339 is nil for a time that was never set.
func optionalRFC3339(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return rfc3339(t)
}

func webhookEventsUnavailable(c *gin.Context, action string, err error) {
	logger.Errorf("admin webhook events: %s: %v", action, err)
	conflictFailure(c, http.StatusServiceUnavailable, "webhook events are unavailable right now; try again later")
}
