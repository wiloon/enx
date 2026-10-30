package billing

import (
	"context"
	"io"
	"net/http"

	"enx-api/billing/webhookevent"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// WebhookReceiver durably receives one Stripe webhook request:
// *webhookevent.Receiver in production.
type WebhookReceiver interface {
	Receive(ctx context.Context, payload []byte, sigHeader string) webhookevent.Outcome
}

// ReceiptHandler is the HTTP edge of durable webhook receipt (ADR-067). It
// answers Stripe as soon as the delivery is committed, or refused; business
// processing happens later, in the worker, so no Stripe I/O runs here.
type ReceiptHandler struct {
	receiver WebhookReceiver
	webhooks WebhookObserver
}

// NewReceiptHandler returns the receipt edge. webhooks may be nil.
func NewReceiptHandler(receiver WebhookReceiver, webhooks WebhookObserver) *ReceiptHandler {
	return &ReceiptHandler{receiver: receiver, webhooks: webhooks}
}

// Webhook handles POST /billing/webhook once durable receipt replaces
// Handler.Webhook. Like it, it is unauthenticated (the Stripe-Signature
// header is the trust boundary, ADR-009 Decision 3) and answers with a bare
// status: 200 once the delivery is stored, 400 for a refusal Stripe should
// not retry, 503 while the endpoint's account is not yet discovered and 500
// when storing failed. Every delivery is counted under event type
// "receipt" with the receipt reason, apart from the per-type processing
// outcomes, which belong to the worker.
func (h *ReceiptHandler) Webhook(c *gin.Context) {
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.Warnf("billing: webhook body could not be read: %v", err)
		h.observe("unreadable_body")
		c.Status(http.StatusBadRequest)
		return
	}
	outcome := h.receiver.Receive(c.Request.Context(), payload, c.GetHeader("Stripe-Signature"))
	switch {
	case outcome.Accepted:
	case outcome.Retryable:
		logger.Errorf("billing: webhook delivery not stored: %s", outcome.Reason)
	default:
		logger.Warnf("billing: webhook delivery refused: %s", outcome.Reason)
	}
	h.observe(outcome.Reason)
	c.Status(receiptStatus(outcome))
}

func (h *ReceiptHandler) observe(reason string) {
	if h.webhooks != nil {
		h.webhooks.ObserveWebhook("receipt", reason)
	}
}

func receiptStatus(o webhookevent.Outcome) int {
	switch {
	case o.Accepted:
		return http.StatusOK
	case !o.Retryable:
		return http.StatusBadRequest
	case o.Reason == "endpoint_unknown":
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}

// WebhookObserver records the outcome of a verified or rejected delivery.
type WebhookObserver interface {
	ObserveWebhook(eventType, outcome string)
}
