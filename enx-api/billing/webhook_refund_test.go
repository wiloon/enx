package billing

import (
	"bytes"
	"context"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/email"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
	stripewebhook "github.com/stripe/stripe-go/v86/webhook"
)

// Payloads keep only the fields enx-api reads, in the shape of the sandbox
// events captured for ADR-049 on 2026-10-16 (API 2026-07-29.dahlia,
// Managed Payments on): checkout.session.completed carries payment_intent for
// a top-up, and charge.refunded carries payment_intent plus the cumulative
// amount_refunded.

func chargeRefundedEvent(eventID, paymentIntentID string, refunded, captured int64) stripeSDK.Event {
	return fakeEvent(eventID, stripeSDK.EventTypeChargeRefunded, `{
		"id": "ch_`+eventID+`",
		"object": "charge",
		"payment_intent": "`+paymentIntentID+`",
		"amount": `+strconv.FormatInt(captured, 10)+`,
		"amount_captured": `+strconv.FormatInt(captured, 10)+`,
		"amount_refunded": `+strconv.FormatInt(refunded, 10)+`,
		"refunded": `+strconv.FormatBool(refunded == captured)+`
	}`)
}

func topupCheckoutEvent(eventID, userID, paymentIntentID string) stripeSDK.Event {
	return fakeEvent(eventID, stripeSDK.EventTypeCheckoutSessionCompleted, `{
		"id": "cs_`+eventID+`",
		"mode": "payment",
		"client_reference_id": "`+userID+`",
		"customer": "cus_`+userID+`",
		"payment_intent": "`+paymentIntentID+`",
		"metadata": {"type": "topup", "tier": "small"}
	}`)
}

type recordedRefundNotices struct{ got []email.UnmatchedRefundNotify }

func (r *recordedRefundNotices) NotifyAdminUnmatchedRefund(n email.UnmatchedRefundNotify) error {
	r.got = append(r.got, n)
	return nil
}

// A refund ENX can't match to a grant takes nothing; Stripe must not retry
// it for days, so the webhook succeeds and the admin is told instead.
func TestWebhookChargeRefundedWithNoGrantNotifiesAdminAndSucceeds(t *testing.T) {
	notices := &recordedRefundNotices{}
	h := NewHandler(nil, "https://example.com", testStripe(), nil).WithRefundNotifier(notices)

	pi := "pi_unknown_" + t.Name()
	if err := h.dispatchWebhookEvent(context.Background(), chargeRefundedEvent("evt-"+t.Name(), pi, 150, 499)); err != nil {
		t.Fatalf("charge.refunded = %v, want nil", err)
	}

	if len(notices.got) != 1 {
		t.Fatalf("admin notices = %d, want 1", len(notices.got))
	}
	if n := notices.got[0]; n.PaymentIntentID != pi || n.ChargeID != "ch_evt-"+t.Name() || n.AmountRefunded != 150 || n.EventID != "evt-"+t.Name() {
		t.Fatalf("notice = %+v, want the payment intent, charge, amount and event of the refund", n)
	}
}

// subscriptionPaidSetup seeds an active Pro Plus subscription for userID and
// a Stripe fake whose invoice in_<subID> was paid by paymentIntentID.
func subscriptionPaidSetup(t *testing.T, userID, subID, paymentIntentID string) (*Handler, *stripeFake) {
	t.Helper()
	seedSubscription(t, userID, "cus_"+subID, subID, "active", 0)
	stripe := testStripe()
	stripe.Price.Pro, stripe.Price.ProPlus, stripe.Price.Max = "enx_pro", "enx_pro_plus", "enx_max"
	stripe.Credits.SubscriptionProPlus = 500
	fake := &stripeFake{
		subs:            map[string]string{subID: liveSubscription(subID, "active", 1800000000)},
		invoicePayments: map[string]string{"in_" + subID: paymentIntentID},
	}
	h := NewHandler(fake.client(t), "https://example.com", stripe, nil)

	paid := fakeEvent("evt-paid-"+subID, stripeSDK.EventTypeInvoicePaid, `{
		"id": "in_`+subID+`",
		"period_end": 1800000000,
		"amount_paid": 1000,
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "`+subID+`"}},
		"lines": {"object": "list", "data": [{"id": "il_1", "pricing": {"price_details": {"price": "price_pro_plus"}}}]}
	}`)
	if err := h.dispatchWebhookEvent(context.Background(), paid); err != nil {
		t.Fatalf("invoice.paid: %v", err)
	}
	return h, fake
}

func TestWebhookChargeRefundedClawsBackASubscriptionPeriod(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	pi := "pi_" + t.Name()
	h, _ := subscriptionPaidSetup(t, userID, "sub_"+t.Name(), pi)

	if err := h.dispatchWebhookEvent(context.Background(), chargeRefundedEvent("evt-refund-"+t.Name(), pi, 1000, 1000)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}

	var account sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&account).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if account.SubscriptionBalance != 0 {
		t.Fatalf("subscription = %d, want 0 after the period's payment was refunded", account.SubscriptionBalance)
	}
}

// ADR-049 Decision 8: refunding a subscription payment, full or partial,
// cancels the subscription in Stripe right away.
func TestWebhookChargeRefundedCancelsALiveSubscription(t *testing.T) {
	for _, refunded := range []int64{1000, 400} {
		t.Run(strconv.FormatInt(refunded, 10), func(t *testing.T) {
			name := strings.ReplaceAll(t.Name(), "/", "-")
			userID := "u-" + name
			cleanupBillingUser(t, userID)
			subID := "sub_" + name
			pi := "pi_" + name
			h, fake := subscriptionPaidSetup(t, userID, subID, pi)

			if err := h.dispatchWebhookEvent(context.Background(), chargeRefundedEvent("evt-refund-"+name, pi, refunded, 1000)); err != nil {
				t.Fatalf("charge.refunded: %v", err)
			}
			if got := fake.canceledIDs(); len(got) != 1 || got[0] != subID {
				t.Fatalf("canceled = %v, want [%s]", got, subID)
			}
		})
	}
}

// A failed cancel fails the delivery so Stripe redelivers it; the redelivery
// cancels without clawing back a second time.
func TestWebhookChargeRefundedRetriesAFailedCancelWithoutClawingTwice(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	subID := "sub_" + t.Name()
	pi := "pi_" + t.Name()
	h, fake := subscriptionPaidSetup(t, userID, subID, pi)
	refund := chargeRefundedEvent("evt-refund-"+t.Name(), pi, 1000, 1000)

	fake.cancelFails = true
	if err := h.dispatchWebhookEvent(context.Background(), refund); err == nil {
		t.Fatal("charge.refunded with a failing cancel = nil, want an error so Stripe retries")
	}
	fake.cancelFails = false
	if err := h.dispatchWebhookEvent(context.Background(), refund); err != nil {
		t.Fatalf("redelivered charge.refunded: %v", err)
	}

	if got := fake.canceledIDs(); len(got) != 1 || got[0] != subID {
		t.Fatalf("canceled = %v, want [%s]", got, subID)
	}
	var clawbacks int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ? AND type = ?", userID, "CLAWBACK").Count(&clawbacks).Error; err != nil {
		t.Fatalf("count CLAWBACK rows: %v", err)
	}
	if clawbacks != 1 {
		t.Fatalf("CLAWBACK rows = %d, want 1", clawbacks)
	}
}

func TestWebhookChargeRefundedSkipsCancelWhenStripeSaysItEnded(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	subID := "sub_" + t.Name()
	pi := "pi_" + t.Name()
	h, fake := subscriptionPaidSetup(t, userID, subID, pi)
	fake.subs[subID] = liveSubscription(subID, "canceled", 1800000000)

	if err := h.dispatchWebhookEvent(context.Background(), chargeRefundedEvent("evt-refund-"+t.Name(), pi, 1000, 1000)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}
	if got := fake.canceledIDs(); len(got) != 0 {
		t.Fatalf("canceled = %v, want none for an already canceled subscription", got)
	}
}

func TestWebhookChargeRefundedForATopupLeavesTheSubscriptionAlone(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	subID := "sub_" + t.Name()
	_, fake := subscriptionPaidSetup(t, userID, subID, "pi_sub_"+t.Name())
	stripe := testStripe()
	stripe.Credits.TopupSmall = 300
	h := NewHandler(fake.client(t), "https://example.com", stripe, nil)

	topupPI := "pi_topup_" + t.Name()
	if err := h.dispatchWebhookEvent(context.Background(), topupCheckoutEvent("evt-cs-"+t.Name(), userID, topupPI)); err != nil {
		t.Fatalf("checkout: %v", err)
	}
	if err := h.dispatchWebhookEvent(context.Background(), chargeRefundedEvent("evt-refund-"+t.Name(), topupPI, 499, 499)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}
	if got := fake.canceledIDs(); len(got) != 0 {
		t.Fatalf("canceled = %v, want none for a top-up refund", got)
	}
}

// postSignedEvent delivers one signed event to the real webhook endpoint and
// returns the HTTP status Stripe would see.
func postSignedEvent(t *testing.T, h *Handler, secret, eventID, eventType, object string) int {
	t.Helper()
	payload := []byte(`{"id": "` + eventID + `", "object": "event", "api_version": "` + stripeSDK.APIVersion +
		`", "type": "` + eventType + `", "data": {"object": ` + object + `}}`)
	ts := time.Now()
	header := "t=" + strconv.FormatInt(ts.Unix(), 10) + ",v1=" + hex.EncodeToString(stripewebhook.ComputeSignature(ts, payload, secret))
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/billing/webhook", h.Webhook)
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", bytes.NewReader(payload))
	req.Header.Set("Stripe-Signature", header)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w.Code
}

// ADR-049 实现要点 5: top-up → spend → partial refund → full refund through
// the signed endpoint; balances and the ledger agree at every step.
func TestWebhookRefundStoryTopupSpendPartialThenFullRefund(t *testing.T) {
	const secret = "whsec_refund_story"
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	pi := "pi_" + t.Name()
	stripe := testStripe()
	stripe.WebhookSecret = secret
	stripe.Credits.TopupSmall = 300
	h := NewHandler(fakeConfiguredClient(), "https://example.com", stripe, nil)
	balance := func() int64 {
		var account sqlitex.CreditAccount
		if err := sqlitex.DB.Where("user_id = ?", userID).First(&account).Error; err != nil {
			t.Fatalf("load credit_accounts: %v", err)
		}
		return account.TopupBalance
	}
	refund := func(eventID string, refunded int64) int {
		return postSignedEvent(t, h, secret, eventID, "charge.refunded",
			`{"id": "ch_`+t.Name()+`", "object": "charge", "payment_intent": "`+pi+`", "amount_captured": 499, "amount_refunded": `+strconv.FormatInt(refunded, 10)+`}`)
	}

	if code := postSignedEvent(t, h, secret, "evt-cs-"+t.Name(), "checkout.session.completed",
		`{"id": "cs_`+t.Name()+`", "mode": "payment", "client_reference_id": "`+userID+`", "customer": "cus_`+t.Name()+`", "payment_intent": "`+pi+`", "metadata": {"type": "topup", "tier": "small"}}`); code != http.StatusOK {
		t.Fatalf("checkout: status %d", code)
	}
	if err := credit.Settle(context.Background(), userID, "translate_sentence", 100); err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if got := balance(); got != 200 {
		t.Fatalf("after spending 100: topup = %d, want 200", got)
	}

	if code := refund("evt-refund-1-"+t.Name(), 150); code != http.StatusOK {
		t.Fatalf("partial refund: status %d", code)
	}
	if got := balance(); got != 110 { // 200 − floor(300 × 150 / 499) = 200 − 90
		t.Fatalf("after the partial refund: topup = %d, want 110", got)
	}

	if code := refund("evt-refund-2-"+t.Name(), 499); code != http.StatusOK {
		t.Fatalf("full refund: status %d", code)
	}
	if got := balance(); got != -100 { // the 100 already spent is still owed
		t.Fatalf("after the full refund: topup = %d, want -100", got)
	}

	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ?", userID).Order("created_at, rowid").Find(&rows).Error; err != nil {
		t.Fatalf("load credit_transactions: %v", err)
	}
	var story []string
	for _, r := range rows {
		story = append(story, r.Type+" "+strconv.FormatInt(r.Amount, 10)+" → "+strconv.FormatInt(r.BalanceAfter, 10))
	}
	want := []string{"GRANT_TOPUP 300 → 300", "SETTLE -100 → 200", "CLAWBACK -90 → 110", "CLAWBACK -210 → -100"}
	if strings.Join(story, " | ") != strings.Join(want, " | ") {
		t.Fatalf("ledger = %q, want %q", story, want)
	}
}

func TestWebhookChargeRefundedClawsBackATopup(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	pi := "pi_" + t.Name()
	stripe := testStripe()
	stripe.Credits.TopupSmall = 300
	h := NewHandler(nil, "https://example.com", stripe, nil)

	if err := h.dispatchWebhookEvent(ctx, topupCheckoutEvent("evt-cs-"+t.Name(), userID, pi)); err != nil {
		t.Fatalf("checkout: %v", err)
	}
	if err := h.dispatchWebhookEvent(ctx, chargeRefundedEvent("evt-refund-"+t.Name(), pi, 499, 499)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}

	var account sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&account).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if account.TopupBalance != 0 {
		t.Fatalf("topup = %d, want 0 after a full refund", account.TopupBalance)
	}
}

// ADR-049 Decision 1: a clawback row's note names the Stripe charge, so the
// admin ledger can be matched to the refund in the Stripe Dashboard.
func TestWebhookChargeRefundedNotesTheChargeOnTheClawbackRow(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	pi := "pi_" + t.Name()
	stripe := testStripe()
	stripe.Credits.TopupSmall = 300
	h := NewHandler(nil, "https://example.com", stripe, nil)

	if err := h.dispatchWebhookEvent(ctx, topupCheckoutEvent("evt-cs-"+t.Name(), userID, pi)); err != nil {
		t.Fatalf("checkout: %v", err)
	}
	refundEventID := "evt-refund-" + t.Name()
	if err := h.dispatchWebhookEvent(ctx, chargeRefundedEvent(refundEventID, pi, 150, 499)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}

	var row sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, credit.TypeClawback).First(&row).Error; err != nil {
		t.Fatalf("clawback row: %v", err)
	}
	want := "Stripe charge ch_" + refundEventID + ", 150 of 499 refunded"
	if row.Note != want {
		t.Fatalf("note = %q, want %q", row.Note, want)
	}
}
