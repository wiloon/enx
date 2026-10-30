//go:build integration

package app

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"enx-api/billing/credit"
	"enx-api/utils/sqlitex"
)

func TestMountedDurableRefundAfterConsumptionAppliesCumulativeTopupClawbackOnce(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	if err := credit.Settle(context.Background(), "u_topup", "word", 54); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id                string
		refunded, balance int64
	}{
		{"evt_partial", 1200, 126}, {"evt_full", 3000, -54}, {"evt_full", 3000, -54},
	} {
		object := fmt.Sprintf(`{"id":"ch_topup","object":"charge","payment_intent":"pi_topup","amount_refunded":%d,"amount_captured":3000}`, tc.refunded)
		if code := r.deliver(t, tc.id, "charge.refunded", object); code != http.StatusOK {
			t.Fatalf("receipt = %d", code)
		}
		r.tickers.tick(testPoll)
		eventually(t, "refund processed", func() bool { status, _ := eventStatus(t, tc.id); return status == "processed" })
		balance, err := credit.Balance(context.Background(), "u_topup")
		if err != nil {
			t.Fatal(err)
		}
		if balance != tc.balance {
			t.Fatalf("balance = %d, want %d", balance, tc.balance)
		}
	}
	var n int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM credit_transactions WHERE type='CLAWBACK'").Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("clawback rows = %d, want 2", n)
	}
}

func TestMountedDurableSubscriptionRefundClawsBackItsPoolAndCancelsOnce(t *testing.T) {
	r := newRig(t, "subscribed.sql")
	for _, stmt := range []string{
		"UPDATE credit_transactions SET grant_kind='normal_period',stripe_subscription_id='sub_subscribed',stripe_invoice_id='in_subscribed',period_start=1790000000,period_end=1800000000,purchased=500,applied=500 WHERE id='tx_subscribed_grant'",
		"UPDATE credit_accounts SET topup_balance=42 WHERE user_id='u_subscribed'",
	} {
		if err := sqlitex.DB.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	r.stripe.subscriptionReply = func(id string) string {
		status := "active"
		if r.stripe.subscriptionCancels.Load() > 0 {
			status = "canceled"
		}
		return `{"id":"` + id + `","object":"subscription","customer":"cus_subscribed","status":"` + status + `","items":{"object":"list","has_more":false,"data":[{"id":"si_subscribed","current_period_end":1800000000,"price":{"id":"price_pp_m"}}]}}`
	}
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	object := `{"id":"ch_subscription","object":"charge","payment_intent":"pi_subscribed","amount_refunded":5000,"amount_captured":5000}`
	for range 2 {
		if code := r.deliver(t, "evt_subscription_refund", "charge.refunded", object); code != http.StatusOK {
			t.Fatalf("receipt = %d", code)
		}
		r.tickers.tick(testPoll)
		eventually(t, "subscription refund processed", func() bool { status, _ := eventStatus(t, "evt_subscription_refund"); return status == "processed" })
	}
	balance, err := credit.Balance(context.Background(), "u_subscribed")
	if err != nil {
		t.Fatal(err)
	}
	if balance != 42 {
		t.Fatalf("balance = %d, want only 42 top-up credits", balance)
	}
	if n := r.stripe.subscriptionCancels.Load(); n != 1 {
		t.Fatalf("Stripe cancellations = %d, want 1", n)
	}
	if code := r.deliver(t, "evt_subscription_deleted", "customer.subscription.deleted", `{"id":"sub_subscribed","object":"subscription","customer":"cus_subscribed","status":"canceled"}`); code != http.StatusOK {
		t.Fatalf("deleted receipt = %d", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "canceled subscription snapshot", func() bool { status, _ := eventStatus(t, "evt_subscription_deleted"); return status == "processed" })
	var status string
	if err := sqlitex.DB.Raw("SELECT status FROM subscriptions WHERE stripe_subscription_id='sub_subscribed'").Scan(&status).Error; err != nil {
		t.Fatal(err)
	}
	if status != "canceled" {
		t.Fatalf("local status = %s", status)
	}
}
