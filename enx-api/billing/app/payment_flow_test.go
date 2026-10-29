//go:build integration

package app

import (
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"enx-api/utils/sqlitex"
)

// No subscription metadata is present on the invoice: attribution must come
// from the Checkout association committed by the preceding worker pass.
const paidInvoice = `{"object":"invoice","id":"in_checkout","customer":"cus_topup","billing_reason":"subscription_create","amount_paid":2000,"parent":{"subscription_details":{"subscription":"sub_recovery"}},"lines":{"has_more":false,"data":[{"id":"il_checkout","amount":2000,"parent":{"subscription_item_details":{"subscription":"sub_recovery","subscription_item":"si_checkout","proration":false}},"pricing":{"price_details":{"price":"price_pp_m"}},"period":{"start":1790000000,"end":1800000000}}]}}`

func TestPaidInvoiceRefreshesAcceptedSubscriptionStatus(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	var reads atomic.Int64
	r.stripe.subscriptionReply = func(id string) string {
		status := "active"
		if reads.Add(1) > 1 {
			status = "canceled"
		}
		return `{"id":"` + id + `","object":"subscription","status":"` + status + `","cancel_at_period_end":true,"cancel_at":1800000000,"pending_update":{},"schedule":"sched_1","customer":"cus_topup","items":{"has_more":false,"data":[{"id":"si_checkout","current_period_end":1800000000,"price":{"id":"price_pp_m"}}]}}`
	}
	r.stripe.portalSafe.Store(true)
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	if code := r.deliver(t, "evt_checkout_status", "checkout.session.completed", `{"object":"checkout.session","id":"cs_status","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"sub_recovery","payment_status":"paid"}`); code != http.StatusOK {
		t.Fatalf("Checkout receipt = %d", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "Checkout processing", func() bool { status, _ := eventStatus(t, "evt_checkout_status"); return status == "processed" })
	if code := r.deliver(t, "evt_invoice_status", "invoice.paid", paidInvoice); code != http.StatusOK {
		t.Fatalf("invoice receipt = %d", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "invoice processing", func() bool { status, _ := eventStatus(t, "evt_invoice_status"); return status == "processed" })
	var status string
	if err := sqlitex.DB.Raw("SELECT status FROM subscriptions WHERE stripe_subscription_id = ?", "sub_recovery").Scan(&status).Error; err != nil {
		t.Fatal(err)
	}
	if status != "active" {
		t.Fatalf("subscription status = %q, want live Stripe status active after payment", status)
	}
	var snapshot struct {
		Plan, PriceID                                 string
		CurrentPeriodEnd, CancelAt                    int64
		CancelAtPeriodEnd, PendingUpdate, HasSchedule bool
	}
	if err := sqlitex.DB.Raw("SELECT plan, price_id, current_period_end, cancel_at_period_end, cancel_at, pending_update, has_schedule FROM subscriptions WHERE stripe_subscription_id = 'sub_recovery'").Scan(&snapshot).Error; err != nil {
		t.Fatal(err)
	}
	if snapshot.Plan != "pro-plus" || snapshot.PriceID != "price_pp_m" || snapshot.CurrentPeriodEnd != 1800000000 || snapshot.CancelAt != 1800000000 || !snapshot.CancelAtPeriodEnd || !snapshot.PendingUpdate || !snapshot.HasSchedule {
		t.Fatalf("incomplete live snapshot: %+v", snapshot)
	}
	assertPaymentState(t, "sub_recovery", 5000, 1)
}

func TestMountedCheckoutAndPaidInvoiceGrantOnceAcrossRedeliveryAndAnotherEventID(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if t.Failed() {
			var rows []map[string]any
			if err := sqlitex.DB.Raw("SELECT event_id, status, last_error FROM stripe_webhook_events").Scan(&rows).Error; err != nil {
				t.Error(err)
			}
			t.Logf("event outcomes: %v", rows)
		}
	})
	r.stripe.portalSafe.Store(true)
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })

	if code := r.deliver(t, "evt_checkout", "checkout.session.completed", `{"object":"checkout.session","id":"cs_subscription","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"sub_recovery","payment_status":"paid"}`); code != http.StatusOK {
		t.Fatalf("Checkout receipt = %d, want 200", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "Checkout processing", func() bool {
		status, _ := eventStatus(t, "evt_checkout")
		return status == "processed"
	})
	assertPaymentState(t, "", 0, 0)

	if code := r.deliver(t, "evt_invoice", "invoice.paid", paidInvoice); code != http.StatusOK {
		t.Fatalf("paid invoice receipt = %d, want 200", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "invoice processing", func() bool {
		status, _ := eventStatus(t, "evt_invoice")
		return status == "processed"
	})
	assertPaymentState(t, "sub_recovery", 5000, 1)

	// Spending part of the grant makes an accidental replay reset visible,
	// even if ledger uniqueness happens to reject an additional ledger row.
	if err := sqlitex.DB.Exec("UPDATE credit_accounts SET subscription_balance = 4321 WHERE user_id = 'u_topup'").Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"evt_invoice", "evt_invoice_replay"} {
		if code := r.deliver(t, id, "invoice.paid", paidInvoice); code != http.StatusOK {
			t.Fatalf("invoice replay %s receipt = %d, want 200", id, code)
		}
		r.tickers.tick(testPoll)
		eventually(t, "replay processing", func() bool {
			status, _ := eventStatus(t, id)
			return status == "processed"
		})
		assertPaymentState(t, "sub_recovery", 4321, 1)
	}
	if n := countRows(t, "stripe_webhook_deliveries"); n != 4 {
		t.Errorf("deliveries = %d, want 4 (including redelivery)", n)
	}
	if n := countRows(t, "stripe_webhook_events"); n != 3 {
		t.Errorf("events = %d, want 3", n)
	}
	_, attempts := eventStatus(t, "evt_invoice")
	if attempts != 1 {
		t.Errorf("original invoice attempts = %d, want 1 despite redelivery", attempts)
	}
}

func assertPaymentState(t *testing.T, accepted string, balance, grants int64) {
	t.Helper()
	var state struct {
		Accepted string
		Balance  int64
		Topup    int64
		Grants   int64
	}
	err := sqlitex.DB.Raw(`SELECT COALESCE(u.accepted_subscription_id, '') AS accepted,
		c.subscription_balance AS balance, c.topup_balance AS topup,
		(SELECT count(*) FROM credit_transactions WHERE stripe_invoice_id = 'in_checkout') AS grants
		FROM users u JOIN credit_accounts c ON c.user_id = u.id WHERE u.id = 'u_topup'`).Scan(&state).Error
	if err != nil {
		t.Fatal(err)
	}
	if state.Accepted != accepted || state.Balance != balance || state.Topup != 300 || state.Grants != grants {
		t.Fatalf("payment state = %+v, want accepted=%q balance=%d topup=300 grants=%d", state, accepted, balance, grants)
	}
	if grants == 0 {
		return
	}
	var grant struct {
		Type                 string
		Tier                 string
		GrantKind            string
		StripeSubscriptionID string
		Amount               int64
		Purchased            int64
		Applied              int64
		PeriodStart          int64
		PeriodEnd            int64
	}
	if err := sqlitex.DB.Raw("SELECT * FROM credit_transactions WHERE stripe_invoice_id = 'in_checkout'").Scan(&grant).Error; err != nil {
		t.Fatal(err)
	}
	if grant.Type != "GRANT_SUBSCRIPTION" || grant.Tier != "pro-plus" || grant.GrantKind != "normal_period" || grant.StripeSubscriptionID != "sub_recovery" || grant.Amount != 5000 || grant.Purchased != 5000 || grant.Applied != 5000 || grant.PeriodStart != 1790000000 || grant.PeriodEnd != 1800000000 {
		t.Fatalf("invoice grant lost its configured credits or provenance: %+v", grant)
	}
}

func TestPaidConflictRetainsOwnershipAndAlertWhenLivePriceIsUnknown(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	r.stripe.portalSafe.Store(true)
	r.stripe.subscriptionReply = func(id string) string {
		price := "price_pp_m"
		if id == "sub_conflict" {
			price = "price_unknown"
		}
		return `{"id":"` + id + `","object":"subscription","status":"active","customer":"cus_topup","items":{"has_more":false,"data":[{"id":"si_1","current_period_end":1800000000,"price":{"id":"` + price + `"}}]}}`
	}
	r.start(t)
	eventually(t, "discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	process := func(id, kind, object, outcome string) {
		t.Helper()
		if code := r.deliver(t, id, kind, object); code != http.StatusOK {
			t.Fatalf("receipt = %d", code)
		}
		r.tickers.tick(testPoll)
		eventually(t, id, func() bool { status, _ := eventStatus(t, id); return status == outcome })
	}
	for _, sub := range []string{"sub_recovery", "sub_conflict"} {
		process("cs_"+sub, "checkout.session.completed", `{"object":"checkout.session","id":"cs_`+sub+`","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"`+sub+`","payment_status":"paid"}`, "processed")
		outcome := "processed"
		if sub == "sub_conflict" {
			outcome = "needs_attention"
		}
		process("in_"+sub, "invoice.paid", strings.NewReplacer("sub_recovery", sub, "in_checkout", "in_"+sub).Replace(paidInvoice), outcome)
	}
	var row struct{ UserID, Classification, ConflictStatus, ConflictAlertState string }
	if err := sqlitex.DB.Raw("SELECT user_id, classification, conflict_status, conflict_alert_state FROM subscriptions WHERE stripe_subscription_id = 'sub_conflict'").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.UserID != "u_topup" || row.Classification != "conflict" || row.ConflictStatus != "open" || row.ConflictAlertState == "" {
		t.Fatalf("lost conflict investigation context: %+v", row)
	}
	var grants int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM credit_transactions WHERE stripe_invoice_id = 'in_sub_conflict'").Scan(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if grants != 0 {
		t.Fatalf("conflict granted %d ledger entries", grants)
	}
}

func TestPaidInvoiceRetriesStripeFailureWithoutPartialGrant(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	r.stripe.portalSafe.Store(true)
	r.start(t)
	eventually(t, "discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	if code := r.deliver(t, "cs_retry", "checkout.session.completed", `{"object":"checkout.session","id":"cs_retry","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"sub_recovery","payment_status":"paid"}`); code != http.StatusOK {
		t.Fatal(code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "checkout", func() bool { status, _ := eventStatus(t, "cs_retry"); return status == "processed" })
	r.stripe.subscriptionFails.Store(true)
	if code := r.deliver(t, "in_retry", "invoice.paid", paidInvoice); code != http.StatusOK {
		t.Fatal(code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "retry after query failure", func() bool {
		status, attempts := eventStatus(t, "in_retry")
		return status == "pending" && attempts > 0
	})
	assertPaymentState(t, "", 0, 0)
	r.stripe.subscriptionFails.Store(false)
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET next_attempt_at = 0 WHERE event_id = 'in_retry'").Error; err != nil {
		t.Fatal(err)
	}
	r.tickers.tick(testPoll)
	eventually(t, "invoice recovered", func() bool { status, _ := eventStatus(t, "in_retry"); return status == "processed" })
	assertPaymentState(t, "sub_recovery", 5000, 1)
}

func TestPaidInvoiceOfEndedUnacceptedSubscriptionKeepsStaleContextWithoutCredits(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	r.stripe.portalSafe.Store(true)
	r.stripe.subscriptionReply = func(id string) string {
		return `{"id":"` + id + `","object":"subscription","status":"canceled","customer":"cus_topup","items":{"has_more":false,"data":[{"price":{"id":"price_pp_m"},"current_period_end":1800000000}]}}`
	}
	r.start(t)
	eventually(t, "discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	if code := r.deliver(t, "cs_ended", "checkout.session.completed", `{"object":"checkout.session","id":"cs_ended","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"sub_recovery","payment_status":"paid"}`); code != http.StatusOK {
		t.Fatal(code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "checkout", func() bool { status, _ := eventStatus(t, "cs_ended"); return status == "processed" })
	if code := r.deliver(t, "in_ended", "invoice.paid", paidInvoice); code != http.StatusOK {
		t.Fatal(code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "stale payment", func() bool { status, _ := eventStatus(t, "in_ended"); return status == "needs_attention" })
	assertPaymentState(t, "", 0, 0)
	var row struct{ Status, Classification, UserID string }
	if err := sqlitex.DB.Raw("SELECT status, classification, user_id FROM subscriptions WHERE stripe_subscription_id = 'sub_recovery'").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "canceled" || row.Classification != "stale" || row.UserID != "u_topup" {
		t.Fatalf("stale context: %+v", row)
	}
}
