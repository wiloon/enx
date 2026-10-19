package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
	stripewebhook "github.com/stripe/stripe-go/v86/webhook"
)

const refundWebhookSecret = "whsec_refund_e2e"

// fakeStripeAPI stands in for the Stripe API: prices by lookup key ("enx_<x>"
// is price "price_<x>"), the payment intent of each paid invoice, and
// subscriptions that DELETE cancels. Each cancel is recorded.
type fakeStripeAPI struct {
	mu              sync.Mutex
	subs            map[string]string // id -> status
	invoicePayments map[string]string // invoice id -> payment intent id
	canceled        []string
}

func (f *fakeStripeAPI) canceledIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.canceled...)
}

func (f *fakeStripeAPI) serveHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.URL.Path == "/v1/prices":
		key := strings.TrimPrefix(r.URL.Query().Get("lookup_keys[0]"), "enx_")
		_, _ = w.Write([]byte(`{"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_` + key + `","object":"price"}]}`))
	case r.URL.Path == "/v1/invoice_payments":
		var data string
		if pi, ok := f.invoicePayments[r.URL.Query().Get("invoice")]; ok {
			data = `{"id":"inpay_1","object":"invoice_payment","status":"paid","is_default":true,` +
				`"payment":{"type":"payment_intent","payment_intent":"` + pi + `"}}`
		}
		_, _ = w.Write([]byte(`{"object":"list","url":"/v1/invoice_payments","has_more":false,"data":[` + data + `]}`))
	case strings.HasPrefix(r.URL.Path, "/v1/subscriptions/") && f.subs[strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")] != "":
		id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
		if r.Method == http.MethodDelete {
			f.canceled = append(f.canceled, id)
			f.subs[id] = "canceled"
		}
		_, _ = w.Write([]byte(`{"id":"` + id + `","object":"subscription","status":"` + f.subs[id] + `",` +
			`"items":{"object":"list","data":[{"id":"si_` + id + `","object":"subscription_item","current_period_end":1800000000}]}}`))
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such resource"}}`))
	}
}

// client is a Stripe client whose API calls reach f.
func (f *fakeStripeAPI) client(t *testing.T) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(f.serveHTTP))
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL:               stripeSDK.String(server.URL),
		HTTPClient:        server.Client(),
		MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_refund_e2e", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

// refundEnv boots the full server with Stripe and the model faked. Billing
// is priced so one AI word costs 54 credits: (150 in × 1 + 40 out × 3) ÷ 5.
// It returns the plain user's id and token and the admin's token.
func refundEnv(t *testing.T, fake *fakeStripeAPI) (base, userToken, adminToken, userID string) {
	t.Helper()
	model := fakeDeepSeek(t, confidentReply)

	cfg := noTrialConfig()
	cfg.Stripe.WebhookSecret = config.Secret(refundWebhookSecret)
	cfg.Stripe.Price.Pro, cfg.Stripe.Price.ProPlus, cfg.Stripe.Price.Max = "enx_pro", "enx_pro_plus", "enx_max"
	cfg.Stripe.Credits.TopupSmall = 300
	cfg.Stripe.Credits.SubscriptionProPlus = 500
	cfg.Stripe.Costs.DefineWord = config.TokenPrice{WeightIn: 1, WeightOut: 3, Divisor: 5}
	cfg.SentenceTranslate.Provider = "deepseek"
	cfg.SentenceTranslate.DeepSeek = config.OpenAICompatible{APIKey: "test-key", BaseURL: model.URL}

	sc := fake.client(t)
	base, adminToken, userToken = adminDictEnvServed(t, cfg, func(t *testing.T, cfg *config.Config) (*httptest.Server, func()) {
		gin.SetMode(gin.TestMode)
		ts := httptest.NewServer(setupRouterWithStripe(cfg, metrics.New(), sc))
		return ts, ts.Close
	})
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM words WHERE english IN (?, ?)", "rizzler", "zzzword")
		sqlitex.DB.Exec("DELETE FROM credit_accounts")
		sqlitex.DB.Exec("DELETE FROM credit_transactions")
		sqlitex.DB.Exec("DELETE FROM subscriptions")
	})
	return base, userToken, adminToken, plainUserID(t, base, userToken)
}

// postStripeEvent delivers one event to /billing/webhook, signed with the
// webhook secret the way Stripe signs it, and fails the test unless it is
// accepted.
func postStripeEvent(t *testing.T, base, eventID, eventType, object string) {
	t.Helper()
	payload := []byte(`{"id": "` + eventID + `", "object": "event", "api_version": "` + stripeSDK.APIVersion +
		`", "created": ` + strconv.FormatInt(time.Now().Unix(), 10) +
		`, "type": "` + eventType + `", "data": {"object": ` + object + `}}`)
	signed := stripewebhook.GenerateTestSignedPayload(&stripewebhook.UnsignedPayload{
		Payload: payload, Secret: refundWebhookSecret, Timestamp: time.Now(),
	})
	req, err := http.NewRequest(http.MethodPost, base+"/billing/webhook", bytes.NewReader(signed.Payload))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Stripe-Signature", signed.Header)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /billing/webhook %s: %v", eventType, err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /billing/webhook %s %s: status %d, want 200", eventType, eventID, resp.StatusCode)
	}
}

// Payload shapes follow the sandbox events in billing/webhook_refund_test.go.

func topupCompleted(userID, paymentIntentID string) string {
	return `{"id": "cs_` + paymentIntentID + `", "object": "checkout.session", "mode": "payment", "client_reference_id": "` + userID +
		`", "customer": "cus_refund_e2e", "payment_intent": "` + paymentIntentID + `", "metadata": {"type": "topup", "tier": "small"}}`
}

func subscriptionCompleted(userID, subscriptionID string) string {
	return `{"id": "cs_` + subscriptionID + `", "object": "checkout.session", "mode": "subscription", "client_reference_id": "` + userID +
		`", "customer": "cus_refund_e2e", "subscription": "` + subscriptionID + `", "metadata": {"type": "subscription", "plan": "pro-plus"}}`
}

func invoicePaid(invoiceID, subscriptionID string, amountPaid int64) string {
	return `{"id": "` + invoiceID + `", "object": "invoice", "period_end": 1800000000, "amount_paid": ` + strconv.FormatInt(amountPaid, 10) +
		`, "parent": {"type": "subscription_details", "subscription_details": {"subscription": "` + subscriptionID + `"}}` +
		`, "lines": {"object": "list", "data": [{"id": "il_1", "pricing": {"price_details": {"price": "price_pro_plus"}}}]}}`
}

func chargeRefunded(paymentIntentID string, refunded, captured int64) string {
	return `{"id": "ch_` + paymentIntentID + `", "object": "charge", "payment_intent": "` + paymentIntentID +
		`", "amount": ` + strconv.FormatInt(captured, 10) + `, "amount_captured": ` + strconv.FormatInt(captured, 10) +
		`, "amount_refunded": ` + strconv.FormatInt(refunded, 10) + `, "refunded": ` + strconv.FormatBool(refunded == captured) + `}`
}

// askAIWord defines word through the AI word fallback, which bills the user.
func askAIWord(t *testing.T, base, token, word string) {
	t.Helper()
	code, body := doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]string{"word": word})
	if code != http.StatusOK || body["found"] != true {
		t.Fatalf("ai-word %s: code=%d body=%+v", word, code, body)
	}
}

// billingView is what the admin pages show of one user's credit.
type billingView struct {
	Ledger                            string // "TYPE amount→balanceAfter", newest first
	Subscription, Topup, Trial, Total int64
	Paid, Consumed, ClawedBack        int64
	HadClawback                       bool
	Status                            string
}

// adminView reads userID's credit through the admin API, and fails the test
// if the users list and the user's detail page disagree.
func adminView(t *testing.T, base, adminToken, userID string) billingView {
	t.Helper()
	code, body := doJSON(t, http.MethodGet, base+"/api/admin/users/"+userID, adminToken)
	if code != http.StatusOK {
		t.Fatalf("admin detail: status %d body %v", code, body)
	}
	user := body["user"].(map[string]any)

	code, body = doJSON(t, http.MethodGet, base+"/api/admin/users?q=plain@", adminToken)
	if code != http.StatusOK || body["total"] != float64(1) {
		t.Fatalf("admin list: status %d body %v", code, body)
	}
	row := body["users"].([]any)[0].(map[string]any)
	for _, k := range []string{"balances", "totals", "hadClawback", "subscriptionStatus"} {
		if !reflect.DeepEqual(row[k], user[k]) {
			t.Fatalf("admin list %s = %v, detail %s = %v; want them equal", k, row[k], k, user[k])
		}
	}

	code, body = doJSON(t, http.MethodGet, base+"/api/admin/users/"+userID+"/transactions", adminToken)
	if code != http.StatusOK || body["next"] != "" {
		t.Fatalf("admin transactions: status %d body %v; want one page", code, body)
	}
	var ledger []string
	for _, r := range body["transactions"].([]any) {
		m := r.(map[string]any)
		ledger = append(ledger, m["type"].(string)+" "+num(m["amount"])+"→"+num(m["balanceAfter"]))
	}

	balances := user["balances"].(map[string]any)
	totals := user["totals"].(map[string]any)
	return billingView{
		Ledger:       strings.Join(ledger, ", "),
		Subscription: int64(balances["subscription"].(float64)),
		Topup:        int64(balances["topup"].(float64)),
		Trial:        int64(balances["trial"].(float64)),
		Total:        int64(balances["total"].(float64)),
		Paid:         int64(totals["paid"].(float64)),
		Consumed:     int64(totals["consumed"].(float64)),
		ClawedBack:   int64(totals["clawedBack"].(float64)),
		HadClawback:  user["hadClawback"].(bool),
		Status:       user["subscriptionStatus"].(string),
	}
}

func num(v any) string { return strconv.FormatInt(int64(v.(float64)), 10) }

func expectView(t *testing.T, step string, got, want billingView) {
	t.Helper()
	if got != want {
		t.Fatalf("after %s:\n got  %+v\n want %+v", step, got, want)
	}
}

// ADR-049 end to end: a top-up is bought, partly spent, refunded in part and
// then in full. Ledger, balances and admin totals agree after every step,
// and the spent part stays owed as a negative top-up balance.
func TestE2E_RefundTopupConsumePartialThenFullRefund(t *testing.T) {
	fake := &fakeStripeAPI{}
	base, userToken, adminToken, userID := refundEnv(t, fake)
	const pi = "pi_A"
	view := func() billingView { return adminView(t, base, adminToken, userID) }

	// 1. The top-up is paid: 300 credits for 4.99.
	postStripeEvent(t, base, "evt_topup_A", "checkout.session.completed", topupCompleted(userID, pi))
	want := billingView{
		Ledger: "GRANT_TOPUP 300→300",
		Topup:  300, Total: 300, Paid: 300, Status: "none",
	}
	expectView(t, "the top-up", view(), want)

	// 2. One AI word costs 54.
	askAIWord(t, base, userToken, "rizzler")
	want.Ledger = "SETTLE -54→246, " + want.Ledger
	want.Topup, want.Total, want.Consumed = 246, 246, 54
	expectView(t, "an AI request", view(), want)

	// 3. 1.50 of 4.99 is refunded: floor(300 × 150 ÷ 499) = floor(90.18) = 90.
	postStripeEvent(t, base, "evt_refund_A_partial", "charge.refunded", chargeRefunded(pi, 150, 499))
	want.Ledger = "CLAWBACK -90→156, " + want.Ledger
	want.Topup, want.Total, want.ClawedBack, want.HadClawback = 156, 156, 90, true
	expectView(t, "the partial refund", view(), want)

	// 4. The rest is refunded: only the 210 not yet taken goes, and the 54
	// already spent stays owed.
	postStripeEvent(t, base, "evt_refund_A_full", "charge.refunded", chargeRefunded(pi, 499, 499))
	want.Ledger = "CLAWBACK -210→-54, " + want.Ledger
	want.Topup, want.Total, want.ClawedBack = -54, -54, 300
	expectView(t, "the full refund", view(), want)

	// 5. Stripe redelivers the full refund: nothing changes.
	postStripeEvent(t, base, "evt_refund_A_full", "charge.refunded", chargeRefunded(pi, 499, 499))
	expectView(t, "the redelivered full refund", view(), want)

	if got := fake.canceledIDs(); len(got) != 0 {
		t.Fatalf("canceled = %v, want none for a top-up refund", got)
	}
}

// ADR-049 Decisions 7 and 8 end to end: refunding a subscription payment
// empties the subscription pool (never below zero), leaves the top-up alone,
// and cancels the subscription in Stripe exactly once.
func TestE2E_RefundSubscriptionPeriod(t *testing.T) {
	const subID = "sub_S"
	fake := &fakeStripeAPI{
		subs:            map[string]string{subID: "active"},
		invoicePayments: map[string]string{"in_S": "pi_S"},
	}
	base, userToken, adminToken, userID := refundEnv(t, fake)
	view := func() billingView { return adminView(t, base, adminToken, userID) }

	// A top-up bought earlier, which the subscription refund must not touch.
	postStripeEvent(t, base, "evt_topup_T", "checkout.session.completed", topupCompleted(userID, "pi_T"))
	postStripeEvent(t, base, "evt_checkout_S", "checkout.session.completed", subscriptionCompleted(userID, subID))
	want := billingView{
		Ledger: "GRANT_TOPUP 300→300",
		Topup:  300, Total: 300, Paid: 300, Status: "active",
	}
	expectView(t, "the top-up and the subscription checkout", view(), want)

	// 1. The first period is paid by pi_S: 500 subscription credits.
	postStripeEvent(t, base, "evt_invoice_S", "invoice.paid", invoicePaid("in_S", subID, 1000))
	want.Ledger = "GRANT_SUBSCRIPTION 500→500, " + want.Ledger
	want.Subscription, want.Total, want.Paid = 500, 800, 800
	expectView(t, "the paid period", view(), want)

	// 2. One AI word, paid from the subscription pool. A SETTLE row's
	// balance is the spendable total; grant and clawback rows give their pool's.
	askAIWord(t, base, userToken, "zzzword")
	want.Ledger = "SETTLE -54→746, " + want.Ledger
	want.Subscription, want.Total, want.Consumed = 446, 746, 54
	expectView(t, "an AI request", view(), want)

	// 3. The period's payment is refunded in full: the 446 left go, not the
	// whole 500, and the subscription is canceled in Stripe.
	postStripeEvent(t, base, "evt_refund_S", "charge.refunded", chargeRefunded("pi_S", 1000, 1000))
	want.Ledger = "CLAWBACK -446→0, " + want.Ledger
	want.Subscription, want.Total, want.ClawedBack, want.HadClawback = 0, 300, 446, true
	expectView(t, "the refund", view(), want)
	if got := fake.canceledIDs(); len(got) != 1 || got[0] != subID {
		t.Fatalf("canceled = %v, want [%s]", got, subID)
	}

	// 4. Stripe reports the cancellation; the admin sees it.
	postStripeEvent(t, base, "evt_deleted_S", "customer.subscription.deleted",
		`{"id": "`+subID+`", "object": "subscription", "status": "canceled"}`)
	want.Status = "canceled"
	expectView(t, "customer.subscription.deleted", view(), want)
}
