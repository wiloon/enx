package billing

import (
	"context"
	"errors"
	"testing"

	"enx-api/billing/credit"
	"enx-api/referral"
	"enx-api/utils/sqlitex"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// The webhook tells the referral domain about each payment (ADR-051
// Decision 5); the domain decides whether it is a first payment.

type recordedPayment struct {
	UserID  string
	Payment referral.FirstPayment
}

type recordingPayments struct {
	got  []recordedPayment
	fail bool
}

func (r *recordingPayments) RecordFirstPayment(_ context.Context, userID string, p referral.FirstPayment) error {
	r.got = append(r.got, recordedPayment{userID, p})
	if r.fail {
		return errors.New("referrals table locked")
	}
	return nil
}

func invoicePaidEvent(eventID, subID string, amountPaid string) stripeSDK.Event {
	return fakeEvent(eventID, stripeSDK.EventTypeInvoicePaid, `{
		"id": "in_`+subID+`",
		"period_end": 1800000000,
		"amount_paid": `+amountPaid+`,
		"parent": {"type": "subscription_details", "subscription_details": {"subscription": "`+subID+`"}},
		"lines": {"object": "list", "data": [{"id": "il_1", "pricing": {"price_details": {"price": "price_pro_plus"}}}]}
	}`)
}

// subscriptionHandler seeds userID's subscription subID and a Stripe fake
// whose invoice in_<subID> was paid by paymentIntentID ("" = lookup fails).
func subscriptionHandler(t *testing.T, userID, subID, paymentIntentID string) *Handler {
	t.Helper()
	seedSubscription(t, userID, "cus_"+subID, subID, "active", 0)
	stripe := testStripe()
	stripe.Price.Pro, stripe.Price.ProPlus, stripe.Price.Max = "enx_pro", "enx_pro_plus", "enx_max"
	stripe.Credits.SubscriptionProPlus = 500
	fake := &stripeFake{
		subs:            map[string]string{subID: liveSubscription(subID, "active", 1800000000)},
		invoicePayments: map[string]string{},
	}
	if paymentIntentID != "" {
		fake.invoicePayments["in_"+subID] = paymentIntentID
	}
	return NewHandler(fake.client(t), "https://example.com", stripe, nil)
}

func TestInvoicePaidRecordsASubscriptionPaymentForReferrals(t *testing.T) {
	userID, subID := "u-"+t.Name(), "sub_"+t.Name()
	recorder := &recordingPayments{}
	h := subscriptionHandler(t, userID, subID, "pi_"+t.Name()).WithFirstPaymentRecorder(recorder)

	if err := h.dispatchWebhookEvent(context.Background(), invoicePaidEvent("evt-"+t.Name(), subID, "1000")); err != nil {
		t.Fatalf("invoice.paid: %v", err)
	}
	if len(recorder.got) != 1 {
		t.Fatalf("recorded payments = %+v, want one", recorder.got)
	}
	got := recorder.got[0]
	if got.UserID != userID || got.Payment.Kind != referral.KindSubscription || got.Payment.InvoiceID != "in_"+subID ||
		got.Payment.PaymentIntentID != "pi_"+t.Name() || got.Payment.Credits != 500 {
		t.Fatalf("recorded = %+v, want the subscription's invoice, intent and 500 credits", got)
	}
}

func TestInvoicePaidRecordsTheInvoiceWhenTheIntentLookupFails(t *testing.T) {
	userID, subID := "u-"+t.Name(), "sub_"+t.Name()
	recorder := &recordingPayments{}
	h := subscriptionHandler(t, userID, subID, "").WithFirstPaymentRecorder(recorder)

	if err := h.dispatchWebhookEvent(context.Background(), invoicePaidEvent("evt-"+t.Name(), subID, "1000")); err != nil {
		t.Fatalf("invoice.paid: %v", err)
	}
	if len(recorder.got) != 1 || recorder.got[0].Payment.PaymentIntentID != "" || recorder.got[0].Payment.InvoiceID != "in_"+subID {
		t.Fatalf("recorded = %+v, want the invoice id and no intent", recorder.got)
	}
}

func TestAZeroAmountInvoiceIsNotAPayment(t *testing.T) {
	userID, subID := "u-"+t.Name(), "sub_"+t.Name()
	recorder := &recordingPayments{}
	h := subscriptionHandler(t, userID, subID, "").WithFirstPaymentRecorder(recorder)

	if err := h.dispatchWebhookEvent(context.Background(), invoicePaidEvent("evt-"+t.Name(), subID, "0")); err != nil {
		t.Fatalf("invoice.paid: %v", err)
	}
	if len(recorder.got) != 0 {
		t.Fatalf("recorded = %+v, want nothing for a 0-amount invoice", recorder.got)
	}
}

func TestTopupCheckoutRecordsATopupPaymentForReferrals(t *testing.T) {
	userID := "u-" + t.Name()
	recorder := &recordingPayments{}
	stripe := testStripe()
	stripe.Credits.TopupSmall = 300
	h := NewHandler(nil, "https://example.com", stripe, nil).WithFirstPaymentRecorder(recorder)

	if err := h.dispatchWebhookEvent(context.Background(), topupCheckoutEvent("evt-"+t.Name(), userID, "pi_"+t.Name())); err != nil {
		t.Fatalf("checkout.session.completed: %v", err)
	}
	if len(recorder.got) != 1 {
		t.Fatalf("recorded payments = %+v, want one", recorder.got)
	}
	got := recorder.got[0]
	if got.UserID != userID || got.Payment.Kind != referral.KindTopup || got.Payment.PaymentIntentID != "pi_"+t.Name() ||
		got.Payment.Credits != 300 || got.Payment.InvoiceID != "" {
		t.Fatalf("recorded = %+v, want the top-up's intent and 300 credits", got)
	}
}

// A referral failure must not fail the webhook: Stripe would retry, and the
// payer's credits are already granted.
func TestAReferralFailureStillSucceedsTheWebhook(t *testing.T) {
	userID := "u-" + t.Name()
	recorder := &recordingPayments{fail: true}
	stripe := testStripe()
	stripe.Credits.TopupSmall = 300
	h := NewHandler(nil, "https://example.com", stripe, nil).WithFirstPaymentRecorder(recorder)

	if err := h.dispatchWebhookEvent(context.Background(), topupCheckoutEvent("evt-"+t.Name(), userID, "pi_"+t.Name())); err != nil {
		t.Fatalf("checkout.session.completed = %v, want success despite the referral failure", err)
	}
	var account sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&account).Error; err != nil {
		t.Fatalf("load credit_accounts: %v", err)
	}
	if account.TopupBalance != 300 {
		t.Fatalf("topup = %d, want the payer's 300 granted", account.TopupBalance)
	}
}

// ADR-051 Decision 5: the referrer's reward carries no payment intent, so
// the invitee's later refund claws back only the invitee's credits.
func TestAnInviteeRefundLeavesTheReferrersRewardAlone(t *testing.T) {
	invitee, referrer := "u-invitee-"+t.Name(), "u-referrer-"+t.Name()
	pi := "pi_" + t.Name()
	stripe := testStripe()
	stripe.Credits.TopupSmall = 300
	h := NewHandler(nil, "https://example.com", stripe, nil)
	ctx := context.Background()

	if err := h.dispatchWebhookEvent(ctx, topupCheckoutEvent("evt-buy-"+t.Name(), invitee, pi)); err != nil {
		t.Fatalf("checkout.session.completed: %v", err)
	}
	if err := credit.GrantReferralReward(ctx, referrer, 60, "referral-reward:"+invitee); err != nil {
		t.Fatalf("GrantReferralReward: %v", err)
	}
	if err := h.dispatchWebhookEvent(ctx, chargeRefundedEvent("evt-refund-"+t.Name(), pi, 299, 299)); err != nil {
		t.Fatalf("charge.refunded: %v", err)
	}

	var inv, ref sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", invitee).First(&inv).Error; err != nil {
		t.Fatalf("load invitee credit_accounts: %v", err)
	}
	if err := sqlitex.DB.Where("user_id = ?", referrer).First(&ref).Error; err != nil {
		t.Fatalf("load referrer credit_accounts: %v", err)
	}
	if inv.TopupBalance != 0 || ref.TopupBalance != 60 {
		t.Fatalf("invitee topup = %d, referrer topup = %d; want 0 and an untouched 60", inv.TopupBalance, ref.TopupBalance)
	}
}
