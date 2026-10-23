package billing

// Characterization of the user-keyed subscriptions table that #297 replaces
// (ADR-067). These tests pin what today's code does, defects included, so
// the schema cutover changes each behaviour on purpose: a test here that
// starts failing during the cutover names a behaviour the cutover must
// replace and re-test under the new rules, not one to restore.

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
	stripewebhook "github.com/stripe/stripe-go/v86/webhook"
)

func subscriptionCheckoutEvent(eventID, userID, customerID, subscriptionID, plan string) stripeSDK.Event {
	return fakeEvent(eventID, stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_`+subscriptionID+`",
		"client_reference_id": "`+userID+`",
		"customer": "`+customerID+`",
		"subscription": "`+subscriptionID+`",
		"metadata": {"type": "subscription", "plan": "`+plan+`"}
	}`)
}

func loadSubscriptionRows(t *testing.T, userID string) []sqlitex.Subscription {
	t.Helper()
	var rows []sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	return rows
}

// Two concurrent Checkouts can both succeed in Stripe. Today the second
// completion overwrites the first subscription in the user's only row, and
// later events for the first subscription find no row at all.
func TestLegacyASecondSubscriptionCheckoutOverwritesTheFirst(t *testing.T) {
	userID := "u-" + t.Name()
	h := NewHandler(fakeStripe(t, map[string]string{
		"sub_first_" + userID:  liveSubscription("sub_first_"+userID, "active", 1700000000),
		"sub_second_" + userID: liveSubscription("sub_second_"+userID, "active", 1700000000),
	}), "https://example.com", testStripe(), nil)
	ctx := context.Background()

	for _, event := range []stripeSDK.Event{
		subscriptionCheckoutEvent("evt-first-"+t.Name(), userID, "cus_first_"+userID, "sub_first_"+userID, "pro"),
		subscriptionCheckoutEvent("evt-second-"+t.Name(), userID, "cus_second_"+userID, "sub_second_"+userID, "max"),
	} {
		if err := h.dispatchWebhookEvent(ctx, event); err != nil {
			t.Fatalf("dispatchWebhookEvent %s: %v", event.ID, err)
		}
	}

	rows := loadSubscriptionRows(t, userID)
	if len(rows) != 1 {
		t.Fatalf("got %d subscriptions rows, want the single user-keyed row", len(rows))
	}
	row := rows[0]
	if row.StripeSubscriptionId == nil || *row.StripeSubscriptionId != "sub_second_"+userID ||
		row.StripeCustomerId != "cus_second_"+userID || row.Plan != "max" {
		t.Fatalf("got %+v, want the second checkout's subscription, customer and plan", row)
	}

	update := fakeEvent("evt-update-first-"+t.Name(), stripeSDK.EventTypeCustomerSubscriptionUpdated,
		`{"id": "sub_first_`+userID+`", "status": "active"}`)
	if err := h.dispatchWebhookEvent(ctx, update); err == nil {
		t.Fatal("an event for the overwritten first subscription succeeded, want the no-local-row error")
	}
}

// A top-up paid under a different Stripe Customer replaces a subscriber's
// Customer in the row, so Portal and later Checkouts follow the top-up's
// Customer while the subscription itself is left in place.
func TestLegacyATopupCheckoutReplacesTheSubscribersCustomer(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_sub_"+userID, "sub_"+userID, "active", 1700000000)
	stripe := testStripe()
	stripe.Credits.TopupSmall = 5
	h := NewHandler(nil, "https://example.com", stripe, nil)

	topup := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_`+userID+`",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_`+userID+`",
		"payment_intent": "pi_topup_`+userID+`",
		"metadata": {"type": "topup", "tier": "small"}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), topup); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	rows := loadSubscriptionRows(t, userID)
	if len(rows) != 1 {
		t.Fatalf("got %d subscriptions rows, want 1", len(rows))
	}
	row := rows[0]
	if row.StripeCustomerId != "cus_topup_"+userID {
		t.Fatalf("customer = %q, want the top-up's cus_topup_%s", row.StripeCustomerId, userID)
	}
	if row.StripeSubscriptionId == nil || *row.StripeSubscriptionId != "sub_"+userID || row.Status != "active" {
		t.Fatalf("got %+v, want the subscription and its status untouched", row)
	}
	if got := existingStripeCustomerID(userID); got != "cus_topup_"+userID {
		t.Fatalf("existingStripeCustomerID = %q, want the top-up's Customer", got)
	}
}

// A top-up-only buyer's row holds just a Customer. Their first subscription
// Checkout rewrites that row in place: the subscription's Customer replaces
// the top-up's, which is then recorded nowhere.
func TestLegacyASubscriptionCheckoutRewritesATopupOnlyRow(t *testing.T) {
	userID := "u-" + t.Name()
	stripe := testStripe()
	stripe.Credits.TopupSmall = 5
	h := NewHandler(fakeStripe(t, map[string]string{
		"sub_" + userID: liveSubscription("sub_"+userID, "active", 1700000000),
	}), "https://example.com", stripe, nil)
	ctx := context.Background()

	topup := fakeEvent("evt-topup-"+t.Name(), stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_topup_`+userID+`",
		"client_reference_id": "`+userID+`",
		"customer": "cus_topup_`+userID+`",
		"metadata": {"type": "topup", "tier": "small"}
	}`)
	for _, event := range []stripeSDK.Event{
		topup,
		subscriptionCheckoutEvent("evt-sub-"+t.Name(), userID, "cus_sub_"+userID, "sub_"+userID, "pro"),
	} {
		if err := h.dispatchWebhookEvent(ctx, event); err != nil {
			t.Fatalf("dispatchWebhookEvent %s: %v", event.ID, err)
		}
	}

	rows := loadSubscriptionRows(t, userID)
	if len(rows) != 1 {
		t.Fatalf("got %d subscriptions rows, want the single user-keyed row", len(rows))
	}
	row := rows[0]
	if row.StripeCustomerId != "cus_sub_"+userID || row.StripeSubscriptionId == nil ||
		*row.StripeSubscriptionId != "sub_"+userID || row.Status != "active" || row.Plan != "pro" {
		t.Fatalf("got %+v, want the subscription checkout's customer, subscription, status and plan", row)
	}
	var topupCustomerRows int64
	if err := sqlitex.DB.Model(&sqlitex.Subscription{}).Where("stripe_customer_id = ?", "cus_topup_"+userID).Count(&topupCustomerRows).Error; err != nil {
		t.Fatalf("count rows for the top-up Customer: %v", err)
	}
	if topupCustomerRows != 0 {
		t.Fatalf("the top-up Customer is still recorded in %d row(s), want none", topupCustomerRows)
	}
}

// Stripe may deliver invoice.paid before checkout.session.completed. Today
// the event fails (non-2xx, relying on Stripe's redelivery) and grants
// nothing.
func TestLegacyInvoicePaidBeforeCheckoutFailsAndGrantsNothing(t *testing.T) {
	userID := "u-" + t.Name()
	stripe := testStripe()
	stripe.Price.Pro, stripe.Price.ProPlus, stripe.Price.Max = "enx_pro", "enx_pro_plus", "enx_max"
	stripe.Credits.SubscriptionPro = 100
	h := NewHandler(fakeStripe(t, map[string]string{
		"sub_" + userID: liveSubscription("sub_"+userID, "active", 1800000000),
	}), "https://example.com", stripe, nil)

	early := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaid, `{
		"id": "in_`+userID+`",
		"period_end": 1700000000,
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "sub_`+userID+`"}},
		"lines": {"object": "list", "data": [{"id": "il_1", "pricing": {"price_details": {"price": "price_pro"}}}]}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), early); err == nil {
		t.Fatal("invoice.paid before checkout succeeded, want the no-local-row error")
	}

	var accounts int64
	if err := sqlitex.DB.Model(&sqlitex.CreditAccount{}).Where("user_id = ?", userID).Count(&accounts).Error; err != nil {
		t.Fatalf("count credit_accounts: %v", err)
	}
	var grants int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("stripe_event_id = ?", early.ID).Count(&grants).Error; err != nil {
		t.Fatalf("count credit_transactions: %v", err)
	}
	if accounts != 0 || grants != 0 {
		t.Fatalf("got %d credit account(s) and %d grant(s), want none", accounts, grants)
	}
}

// invoice.paid takes the tier from the invoice's first line and grants a
// full period whatever the invoice's billing_reason. A plan-change
// (subscription_update) invoice whose first line is the proration credit for
// the old price therefore grants the old tier's full allotment.
func TestLegacyInvoicePaidGrantsAFullPeriodForTheFirstLinesTier(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1800000000)
	stripe := testStripe()
	stripe.Price.Pro, stripe.Price.ProPlus, stripe.Price.Max = "enx_pro", "enx_pro_plus", "enx_max"
	stripe.Credits.SubscriptionPro, stripe.Credits.SubscriptionMax = 100, 900
	h := NewHandler(fakeStripe(t, map[string]string{
		"sub_" + userID: liveSubscription("sub_"+userID, "active", 1800000000),
	}), "https://example.com", stripe, nil)

	update := fakeEvent("evt-"+t.Name(), stripeSDK.EventTypeInvoicePaid, `{
		"id": "in_`+userID+`",
		"billing_reason": "subscription_update",
		"period_end": 1700000000,
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "sub_`+userID+`"}},
		"lines": {"object": "list", "data": [
			{"id": "il_credit", "amount": -500, "pricing": {"price_details": {"price": "price_pro"}}},
			{"id": "il_charge", "amount": 4500, "pricing": {"price_details": {"price": "price_max"}}}
		]}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), update); err != nil {
		t.Fatalf("dispatchWebhookEvent: %v", err)
	}

	var account sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&account).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if account.SubscriptionBalance != 100 {
		t.Fatalf("subscription_balance = %d, want 100 (a full Pro period from the first line)", account.SubscriptionBalance)
	}
	rows := loadSubscriptionRows(t, userID)
	if len(rows) != 1 || rows[0].Plan != "pro" {
		t.Fatalf("got %+v, want the row's plan set to the first line's pro", rows)
	}
}

// A refunded subscription payment cancels the subscription now in the
// user's row, not the one the refunded payment was for: after a second
// Checkout overwrote the row, refunding the first subscription's invoice
// cancels the second subscription.
func TestLegacyARefundCancelsTheSubscriptionInTheRowNotTheRefundedOne(t *testing.T) {
	userID := "u-" + t.Name()
	first, second := "sub_first_"+t.Name(), "sub_second_"+t.Name()
	pi := "pi_" + t.Name()
	h, fake := subscriptionPaidSetup(t, userID, first, pi)
	fake.subs[second] = liveSubscription(second, "active", 1800000000)
	ctx := context.Background()

	if err := h.dispatchWebhookEvent(ctx, subscriptionCheckoutEvent("evt-second-"+t.Name(), userID, "cus_"+second, second, "pro-plus")); err != nil {
		t.Fatalf("second checkout: %v", err)
	}
	if err := h.dispatchWebhookEvent(ctx, chargeRefundedEvent("evt-refund-"+t.Name(), pi, 1000, 1000)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}

	if got := fake.canceledIDs(); len(got) != 1 || got[0] != second {
		t.Fatalf("canceled = %v, want [%s] (the row's subscription), not the refunded %s", got, second, first)
	}
}

// A correctly signed event whose api_version differs from the SDK's pinned
// version is refused as if its signature were bad: 400, nothing applied.
func TestLegacyWebhookRefusesASignedEventFromAnotherAPIVersion(t *testing.T) {
	const secret = "whsec_test_api_version"
	userID := "u-" + t.Name()
	payload := []byte(`{
		"id": "evt-` + t.Name() + `",
		"object": "event",
		"api_version": "2025-01-27.acacia",
		"type": "checkout.session.completed",
		"data": {"object": {
			"id": "cs_api_version",
			"client_reference_id": "` + userID + `",
			"customer": "cus_api_version",
			"metadata": {"type": "topup", "tier": "large"}
		}}
	}`)
	signed := stripewebhook.GenerateTestSignedPayload(&stripewebhook.UnsignedPayload{
		Payload: payload, Secret: secret, Timestamp: time.Now(),
	})

	stripe := testStripe()
	stripe.WebhookSecret = config.Secret(secret)
	stripe.Credits.TopupLarge = 9
	h := NewHandler(fakeConfiguredClient(), "https://example.com", stripe, nil)
	router := gin.New()
	router.POST("/billing/webhook", h.Webhook)
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", bytes.NewReader(signed.Payload))
	req.Header.Set("Stripe-Signature", signed.Header)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	var accounts int64
	if err := sqlitex.DB.Model(&sqlitex.CreditAccount{}).Where("user_id = ?", userID).Count(&accounts).Error; err != nil {
		t.Fatalf("count credit_accounts: %v", err)
	}
	if accounts != 0 {
		t.Fatal("the refused event granted credits")
	}
}

// fakePortalClient answers POST /v1/billing_portal/sessions and hands the
// session-create form to onSession.
func fakePortalClient(t *testing.T, onSession func(form url.Values)) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost || r.URL.Path != "/v1/billing_portal/sessions" {
			t.Errorf("unexpected Stripe call: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse portal session form: %v", err)
		}
		onSession(r.PostForm)
		_, _ = w.Write([]byte(`{"id":"bps_1","object":"billing_portal.session","url":"https://billing.stripe.test/p/session/bps_1"}`))
	}))
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL: stripeSDK.String(server.URL), HTTPClient: server.Client(), MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_fake", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

// Portal opens a session for the Customer in the user's row and names no
// Portal configuration, so Stripe applies the Dashboard default (which may
// allow plan changes).
func TestLegacyPortalOpensTheRowsCustomerWithTheDefaultConfiguration(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)

	var form url.Values
	h := NewHandler(fakePortalClient(t, func(f url.Values) { form = f }), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/portal", h.Portal, userID, ``)

	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"url":"https://billing.stripe.test/p/session/bps_1"`)) {
		t.Fatalf("status = %d body = %s, want 200 with the session url", w.Code, w.Body.String())
	}
	if got := form.Get("customer"); got != "cus_"+userID {
		t.Errorf("customer = %q, want cus_%s", got, userID)
	}
	if got := form.Get("return_url"); got != "https://example.com/billing" {
		t.Errorf("return_url = %q, want https://example.com/billing", got)
	}
	if _, ok := form["configuration"]; ok {
		t.Errorf("configuration = %q, want none sent", form.Get("configuration"))
	}
}

// A subscription Checkout reuses the Customer in the user's row (here a
// top-up-only buyer's) and attributes the purchase only through
// client_reference_id: nothing is written to the Subscription's metadata.
func TestLegacySubscriptionCheckoutReusesTheRowsCustomerAndSetsNoSubscriptionMetadata(t *testing.T) {
	userID := "u-" + t.Name()
	seedUser(t, userID)
	row := sqlitex.Subscription{UserId: userID, StripeCustomerId: "cus_topup_" + userID, Status: "none", CreatedAt: 1, UpdatedAt: 1}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatalf("seed top-up-only row: %v", err)
	}

	var form url.Values
	h := NewHandler(fakeStripeClient(t, func(f url.Values) { form = f }), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, userID, `{"plan":"pro"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", w.Code, w.Body.String())
	}

	if got := form.Get("customer"); got != "cus_topup_"+userID {
		t.Errorf("customer = %q, want the row's cus_topup_%s", got, userID)
	}
	if got := form.Get("client_reference_id"); got != userID {
		t.Errorf("client_reference_id = %q, want %q", got, userID)
	}
	for key := range form {
		if strings.HasPrefix(key, "subscription_data") {
			t.Errorf("%s = %q, want no subscription_data sent", key, form.Get(key))
		}
	}
}
