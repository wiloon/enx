package billing

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	stripeSDK "github.com/stripe/stripe-go/v86"
	stripewebhook "github.com/stripe/stripe-go/v86/webhook"
)

func fakeEvent(id string, eventType stripeSDK.EventType, objJSON string) stripeSDK.Event {
	return stripeSDK.Event{
		ID:   id,
		Type: eventType,
		Data: &stripeSDK.EventData{Raw: json.RawMessage(objJSON)},
	}
}

func TestHandleCheckoutSessionCompletedTopupGrantsCredits(t *testing.T) {
	viperSet(t, "stripe.credits.topup-small", 5)
	userID := "u-" + t.Name()
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_1",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_1",
		"metadata": {"type": "topup", "tier": "small"}
	}`)

	h := NewHandler(nil, "https://example.com", "whsec_test")
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var credit sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&credit).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if credit.TopupBalance != 5 {
		t.Fatalf("got topup_balance=%d, want 5", credit.TopupBalance)
	}
	if got := existingStripeCustomerID(userID); got != "cus_topup_1" {
		t.Fatalf("got customer id %q, want cus_topup_1", got)
	}

	// Retried delivery of the same event must not double-grant.
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("retried dispatchWebhookEvent: %v", err)
	}
	sqlitex.DB.Where("user_id = ?", userID).First(&credit)
	if credit.TopupBalance != 5 {
		t.Fatalf("after retry got topup_balance=%d, want still 5 (idempotent)", credit.TopupBalance)
	}
}

func TestHandleCheckoutSessionCompletedTopupUnconfiguredAmount(t *testing.T) {
	viperSet(t, "stripe.credits.topup-medium", 0)
	userID := "u-" + t.Name()
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_2",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_2",
		"metadata": {"type": "topup", "tier": "medium"}
	}`)

	h := NewHandler(nil, "https://example.com", "whsec_test")
	err := h.dispatchWebhookEvent(context.Background(), event)
	if err == nil {
		t.Fatal("expected an error for an unconfigured (0) credit amount, got nil")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("error should mention the config being unset, got: %v", err)
	}
}

func TestHandleCheckoutSessionCompletedSubscriptionEstablishesMapping(t *testing.T) {
	userID := "u-" + t.Name()
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_sub_1",
		"client_reference_id": "`+userID+`",
		"customer": "cus_sub_1",
		"subscription": "sub_1",
		"metadata": {"type": "subscription", "plan": "pro-plus"}
	}`)

	h := NewHandler(nil, "https://example.com", "whsec_test")
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.StripeCustomerId != "cus_sub_1" || sub.StripeSubscriptionId == nil || *sub.StripeSubscriptionId != "sub_1" || sub.Status != "active" || sub.Plan != "pro-plus" {
		t.Fatalf("got %+v, want customer=cus_sub_1 subscription=sub_1 status=active plan=pro-plus", sub)
	}
}

func TestHandleSubscriptionUpdatedSetsStatusAndPeriodEnd(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_x", "sub_x", "active", 0)

	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionUpdated, `{
		"id": "sub_x",
		"status": "past_due",
		"items": {"object": "list", "data": [{"id": "si_1", "current_period_end": 1700000000}]}
	}`)

	if err := handleSubscriptionUpdated(event); err != nil {
		t.Fatalf("handleSubscriptionUpdated: %v", err)
	}

	var sub sqlitex.Subscription
	sqlitex.DB.Where("user_id = ?", userID).First(&sub)
	if sub.Status != "past_due" || sub.CurrentPeriodEnd != 1700000000 {
		t.Fatalf("got status=%q current_period_end=%d, want past_due/1700000000", sub.Status, sub.CurrentPeriodEnd)
	}
}

func TestHandleSubscriptionUpdatedNoLocalRowIsAnError(t *testing.T) {
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionUpdated, `{
		"id": "sub_never_seen",
		"status": "active"
	}`)
	if err := handleSubscriptionUpdated(event); err == nil {
		t.Fatal("expected an error when no local subscriptions row matches (Stripe should retry)")
	}
}

func TestHandleSubscriptionDeletedSetsCanceled(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_y", "sub_y", "active", 1700000000)

	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionDeleted, `{"id": "sub_y", "status": "canceled"}`)
	if err := handleSubscriptionDeleted(event); err != nil {
		t.Fatalf("handleSubscriptionDeleted: %v", err)
	}

	var sub sqlitex.Subscription
	sqlitex.DB.Where("user_id = ?", userID).First(&sub)
	if sub.Status != "canceled" {
		t.Fatalf("got status=%q, want canceled", sub.Status)
	}
}

func TestHandleInvoicePaymentFailedSetsPastDue(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_z", "sub_z", "active", 1700000000)

	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaymentFailed, `{
		"id": "in_1",
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "sub_z"}}
	}`)
	if err := handleInvoicePaymentFailed(event); err != nil {
		t.Fatalf("handleInvoicePaymentFailed: %v", err)
	}

	var sub sqlitex.Subscription
	sqlitex.DB.Where("user_id = ?", userID).First(&sub)
	if sub.Status != "past_due" {
		t.Fatalf("got status=%q, want past_due", sub.Status)
	}
}

func TestHandleInvoicePaymentFailedOneOffInvoiceIsNoop(t *testing.T) {
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaymentFailed, `{"id": "in_2"}`)
	if err := handleInvoicePaymentFailed(event); err != nil {
		t.Fatalf("expected nil (no-op) for a non-subscription invoice, got: %v", err)
	}
}

func TestDispatchWebhookEventUnknownTypeIsNoop(t *testing.T) {
	h := NewHandler(nil, "https://example.com", "whsec_test")
	event := fakeEvent("evt-"+t.Name(), "some.unhandled.event", `{}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("expected nil for an unhandled event type, got: %v", err)
	}
}

// --- gin-endpoint-level tests: signature verification + status codes ---

func TestWebhookEndpointNotConfigured(t *testing.T) {
	h := NewHandler(nil, "https://example.com", "whsec_test")
	router := gin.New()
	router.POST("/billing/webhook", h.Webhook)

	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503", w.Code)
	}
}

func TestWebhookEndpointBadSignature(t *testing.T) {
	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	router := gin.New()
	router.POST("/billing/webhook", h.Webhook)

	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", strings.NewReader(`{"id":"evt_1"}`))
	req.Header.Set("Stripe-Signature", "t=1,v1=deadbeef")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

func TestWebhookEndpointValidSignatureDispatches(t *testing.T) {
	secret := "whsec_test_endpoint"
	viperSet(t, "stripe.credits.topup-large", 9)
	userID := "u-" + t.Name()

	payload := []byte(`{
		"id": "evt-` + t.Name() + `",
		"object": "event",
		"api_version": "` + stripeSDK.APIVersion + `",
		"type": "checkout.session.completed",
		"data": {"object": {
			"id": "cs_endpoint_1",
			"client_reference_id": "` + userID + `",
			"customer": "cus_endpoint_1",
			"metadata": {"type": "topup", "tier": "large"}
		}}
	}`)

	ts := time.Now()
	sig := stripewebhook.ComputeSignature(ts, payload, secret)
	header := "t=" + strconv.FormatInt(ts.Unix(), 10) + ",v1=" + hex.EncodeToString(sig)

	// fakeConfiguredClient (a fake-but-well-formed key) never makes a
	// network call here: the topup dispatch path doesn't touch the Stripe
	// API at all, only credit.GrantTopup + the local DB.
	h := NewHandler(fakeConfiguredClient(), "https://example.com", secret)
	router := gin.New()
	router.POST("/billing/webhook", h.Webhook)

	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", strings.NewReader(string(payload)))
	req.Header.Set("Stripe-Signature", header)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}

	var credit sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&credit).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if credit.TopupBalance != 9 {
		t.Fatalf("got topup_balance=%d, want 9", credit.TopupBalance)
	}
}

func seedSubscription(t *testing.T, userID, customerID, subscriptionID, status string, periodEnd int64) {
	t.Helper()
	now := time.Now().UnixMilli()
	row := sqlitex.Subscription{
		UserId:               userID,
		StripeCustomerId:     customerID,
		StripeSubscriptionId: &subscriptionID,
		Status:               status,
		CurrentPeriodEnd:     periodEnd,
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
}

// viperSet sets a viper key for the duration of the test and restores it
// afterward, since viper's underlying store is process-global.
func viperSet(t *testing.T, key string, value interface{}) {
	t.Helper()
	previous := viper.Get(key)
	viper.Set(key, value)
	t.Cleanup(func() { viper.Set(key, previous) })
}
