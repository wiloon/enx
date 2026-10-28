package billing

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"enx-api/config"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
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
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_1",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_1",
		"metadata": {"type": "topup", "tier": "small"}
	}`)

	stripe := testStripe()
	stripe.Credits.TopupSmall = 5
	h := NewHandler(nil, "https://example.com", stripe, nil)
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
	var retried sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&retried).Error; err != nil {
		t.Fatalf("reload credit_accounts: %v", err)
	}
	if retried.TopupBalance != 5 {
		t.Fatalf("after retry got topup_balance=%d, want still 5 (idempotent)", retried.TopupBalance)
	}
}

// A one-time payment Checkout Session has no customer unless Stripe was told
// to create one, which is how a first-time buyer's top-up arrived in
// production. The credits are what they paid for, so they still land.
func TestHandleCheckoutSessionCompletedTopupWithoutCustomerGrantsCredits(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_nocus",
		"client_reference_id": "`+userID+`",
		"customer": null,
		"payment_intent": "pi_topup_nocus",
		"metadata": {"type": "topup", "tier": "small"}
	}`)

	stripe := testStripe()
	stripe.Credits.TopupSmall = 5
	h := NewHandler(nil, "https://example.com", stripe, nil)
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
	var subscriptions int64
	if err := sqlitex.DB.Model(&sqlitex.Subscription{}).Where("user_id = ?", userID).Count(&subscriptions).Error; err != nil {
		t.Fatalf("count subscriptions: %v", err)
	}
	if subscriptions != 0 {
		t.Fatalf("got %d subscriptions rows, want none without a customer", subscriptions)
	}
}

func TestHandleCheckoutSessionCompletedTopupUnconfiguredAmount(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_2",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_2",
		"metadata": {"type": "topup", "tier": "medium"}
	}`)

	h := NewHandler(nil, "https://example.com", testStripe(), nil)
	err := h.dispatchWebhookEvent(context.Background(), event)
	if err == nil {
		t.Fatal("expected an error for an unconfigured (0) credit amount, got nil")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("error should mention the config being unset, got: %v", err)
	}
}

// A tier the config does not know grants nothing, even when every known
// tier is configured: it fails like an unconfigured amount (#45).
func TestHandleCheckoutSessionCompletedTopupUnknownTier(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_unknown",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_unknown",
		"metadata": {"type": "topup", "tier": "huge"}
	}`)

	stripe := testStripe()
	stripe.Credits.TopupSmall, stripe.Credits.TopupMedium, stripe.Credits.TopupLarge = 1, 2, 3
	h := NewHandler(nil, "https://example.com", stripe, nil)
	err := h.dispatchWebhookEvent(context.Background(), event)
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("dispatchWebhookEvent = %v, want a not-configured error", err)
	}
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.CreditAccount{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		t.Fatalf("count credit_accounts: %v", err)
	}
	if count != 0 {
		t.Fatalf("an unknown tier created a credit account")
	}
}

func TestHandleCheckoutSessionCompletedSubscriptionEstablishesMapping(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_sub_1",
		"client_reference_id": "`+userID+`",
		"customer": "cus_sub_1",
		"subscription": "sub_1",
		"metadata": {"type": "subscription", "plan": "pro-plus"}
	}`)

	h := NewHandler(fakeStripe(t, map[string]string{"sub_1": liveSubscription("sub_1", "active", 1700000000)}),
		"https://example.com", testStripe(), nil)
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

func TestHandleSubscriptionUpdatedSetsStatusAndPeriodEndFromStripe(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_x", "sub_x", "active", 0)

	h := NewHandler(fakeStripe(t, map[string]string{"sub_x": liveSubscription("sub_x", "past_due", 1700000000)}),
		"https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionUpdated, `{"id": "sub_x", "status": "past_due"}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "past_due" || sub.CurrentPeriodEnd != 1700000000 {
		t.Fatalf("got status=%q current_period_end=%d, want past_due/1700000000", sub.Status, sub.CurrentPeriodEnd)
	}
}

// Stripe does not deliver events in order and redelivers failed ones later:
// a stale customer.subscription.updated ("active") processed after the
// subscription was deleted must not resurrect it.
func TestHandleSubscriptionUpdatedStaleEventAfterDeletionStaysCanceled(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_stale", "sub_stale", "active", 0)

	h := NewHandler(fakeStripe(t, map[string]string{"sub_stale": liveSubscription("sub_stale", "canceled", 1700000000)}),
		"https://example.com", testStripe(), nil)
	ctx := context.Background()
	deleted := fakeEvent("evt-del-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionDeleted, `{"id": "sub_stale", "status": "canceled"}`)
	staleUpdate := fakeEvent("evt-upd-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionUpdated, `{"id": "sub_stale", "status": "active"}`)
	for _, event := range []stripeSDK.Event{deleted, staleUpdate} {
		if err := h.dispatchWebhookEvent(ctx, event); err != nil {
			t.Fatalf("dispatchWebhookEvent %s: %v", event.Type, err)
		}
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "canceled" {
		t.Fatalf("got status=%q, want canceled", sub.Status)
	}
}

// A redelivered checkout.session.completed must not mark an already
// canceled subscription active either.
func TestHandleCheckoutSessionCompletedUsesLiveStatus(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	h := NewHandler(fakeStripe(t, map[string]string{"sub_late": liveSubscription("sub_late", "canceled", 1700000000)}),
		"https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_late",
		"client_reference_id": "`+userID+`",
		"customer": "cus_late",
		"subscription": "sub_late",
		"metadata": {"type": "subscription", "plan": "pro"}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "canceled" {
		t.Fatalf("got status=%q, want canceled", sub.Status)
	}
}

func TestHandleSubscriptionUpdatedNoLocalRowIsAnError(t *testing.T) {
	h := NewHandler(fakeStripe(t, map[string]string{"sub_never_seen": liveSubscription("sub_never_seen", "active", 0)}),
		"https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionUpdated, `{
		"id": "sub_never_seen",
		"status": "active"
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err == nil {
		t.Fatal("expected an error when no local subscriptions row matches (Stripe should retry)")
	}
}

func TestHandleSubscriptionEventStripeErrorIsAnError(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_err", "sub_err", "active", 0)

	h := NewHandler(fakeStripe(t, map[string]string{}), "https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionDeleted, `{"id": "sub_err", "status": "canceled"}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err == nil {
		t.Fatal("expected an error when Stripe can't be reached (Stripe should retry)")
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "active" {
		t.Fatalf("got status=%q, want the row untouched (active)", sub.Status)
	}
}

func TestHandleSubscriptionDeletedSetsCanceled(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_y", "sub_y", "active", 1700000000)

	h := NewHandler(fakeStripe(t, map[string]string{"sub_y": liveSubscription("sub_y", "canceled", 1700000000)}),
		"https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionDeleted, `{"id": "sub_y", "status": "canceled"}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "canceled" {
		t.Fatalf("got status=%q, want canceled", sub.Status)
	}
}

func TestHandleInvoicePaymentFailedSetsPastDue(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_z", "sub_z", "active", 1700000000)

	h := NewHandler(fakeStripe(t, map[string]string{"sub_z": liveSubscription("sub_z", "past_due", 1700000000)}),
		"https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaymentFailed, `{
		"id": "in_1",
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "sub_z"}}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "past_due" {
		t.Fatalf("got status=%q, want past_due", sub.Status)
	}
}

func TestHandleInvoicePaidGrantsCreditsAndSyncsState(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_paid", "sub_paid", "incomplete", 0)
	stripe := testStripe()
	stripe.Price.Pro, stripe.Price.ProPlus, stripe.Price.Max = "enx_pro", "enx_pro_plus", "enx_max"
	stripe.Credits.SubscriptionProPlus = 500

	h := NewHandler(fakeStripe(t, map[string]string{"sub_paid": liveSubscription("sub_paid", "active", 1800000000)}),
		"https://example.com", stripe, nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaid, `{
		"id": "in_paid",
		"period_end": 1700000000,
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "sub_paid"}},
		"lines": {"object": "list", "data": [{"id": "il_1", "pricing": {"price_details": {"price": "price_pro_plus"}}}]}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if sub.Status != "active" || sub.Plan != "pro-plus" || sub.CurrentPeriodEnd != 1800000000 {
		t.Fatalf("got status=%q plan=%q current_period_end=%d, want active/pro-plus/1800000000", sub.Status, sub.Plan, sub.CurrentPeriodEnd)
	}
	var account sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&account).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if account.SubscriptionBalance != 500 {
		t.Fatalf("got subscription_balance=%d, want 500", account.SubscriptionBalance)
	}
}

func TestHandleInvoicePaymentFailedOneOffInvoiceIsNoop(t *testing.T) {
	h := NewHandler(fakeStripe(t, map[string]string{}), "https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaymentFailed, `{"id": "in_2"}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("expected nil (no-op) for a non-subscription invoice, got: %v", err)
	}
}

func TestDispatchWebhookEventUnknownTypeIsNoop(t *testing.T) {
	h := NewHandler(nil, "https://example.com", testStripe(), nil)
	event := fakeEvent("evt-"+t.Name(), "some.unhandled.event", `{}`)
	if err := h.dispatchWebhookEvent(context.Background(), event); err != nil {
		t.Fatalf("expected nil for an unhandled event type, got: %v", err)
	}
}

// --- gin-endpoint-level tests: signature verification + status codes ---

func TestWebhookEndpointNotConfigured(t *testing.T) {
	h := NewHandler(nil, "https://example.com", testStripe(), nil)
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
	h := NewHandler(fakeConfiguredClient(), "https://example.com", testStripe(), nil)
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
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)

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
	stripe := testStripe()
	stripe.WebhookSecret = config.Secret(secret)
	stripe.Credits.TopupLarge = 9
	h := NewHandler(fakeConfiguredClient(), "https://example.com", stripe, nil)
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

// seedTopupOnlyCustomer stores a Customer with no subscription, as a top-up
// checkout leaves it.
func seedTopupOnlyCustomer(t *testing.T, userID, customerID string) {
	t.Helper()
	now := time.Now().UnixMilli()
	row := sqlitex.Subscription{UserId: userID, StripeCustomerId: customerID, CreatedAt: now, UpdatedAt: now}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatalf("seed top-up customer: %v", err)
	}
}

// testStripe is the default Stripe config with the test webhook secret.
func testStripe() config.Stripe {
	stripe := config.Default().Stripe
	stripe.WebhookSecret = "whsec_test"
	return stripe
}

// fakeStripe returns a Stripe client backed by a local server that answers
// GET /v1/subscriptions/{id} from subs (id -> JSON body) and 404s anything
// else, so tests control what "Stripe's current state" is.
func fakeStripe(t *testing.T, subs map[string]string) *stripeSDK.Client {
	t.Helper()
	return (&stripeFake{subs: subs}).client(t)
}

// stripeFake is a local stand-in for the Stripe API. subs answers
// GET /v1/subscriptions/{id} (id -> JSON body); invoicePayments answers
// GET /v1/invoice_payments?invoice= (invoice id -> payment intent id);
// DELETE /v1/subscriptions/{id} cancels, recorded in canceled, or fails with
// a 500 while cancelFails is set. Anything else 404s.
type stripeFake struct {
	subs            map[string]string
	invoicePayments map[string]string
	cancelFails     bool

	mu       sync.Mutex
	canceled []string
}

func (f *stripeFake) canceledIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.canceled...)
}

func (f *stripeFake) client(t *testing.T) *stripeSDK.Client {
	t.Helper()
	notFound := func(w http.ResponseWriter, what string) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such ` + what + `"}}`))
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/prices":
			// Price lookup by lookup_key, as SubscriptionTierForPrice does:
			// lookup key "enx_<x>" maps to price id "price_<x>".
			key := strings.TrimPrefix(r.URL.Query().Get("lookup_keys[0]"), "enx_")
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_` + key + `","object":"price"}]}`))
		case r.URL.Path == "/v1/invoice_payments":
			// Shape of the sandbox response captured for ADR-049.
			var data string
			if pi, ok := f.invoicePayments[r.URL.Query().Get("invoice")]; ok {
				data = `{"id":"inpay_1","object":"invoice_payment","status":"paid","is_default":true,` +
					`"payment":{"type":"payment_intent","payment_intent":"` + pi + `"}}`
			}
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoice_payments","has_more":false,"data":[` + data + `]}`))
		case strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
			id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
			body, ok := f.subs[id]
			switch {
			case !ok:
				notFound(w, "subscription")
			case r.Method == http.MethodDelete && f.cancelFails:
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
			case r.Method == http.MethodDelete:
				f.mu.Lock()
				f.canceled = append(f.canceled, id)
				f.mu.Unlock()
				_, _ = w.Write([]byte(body))
			default:
				_, _ = w.Write([]byte(body))
			}
		default:
			notFound(w, "resource")
		}
	}))
	t.Cleanup(server.Close)

	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL:               stripeSDK.String(server.URL),
		HTTPClient:        server.Client(),
		MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_123", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

func liveSubscription(id, status string, periodEnd int64) string {
	return `{"id":"` + id + `","object":"subscription","status":"` + status + `",` +
		`"items":{"object":"list","data":[{"id":"si_` + id + `","object":"subscription_item","current_period_end":` +
		strconv.FormatInt(periodEnd, 10) + `}]}}`
}
