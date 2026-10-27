//go:build integration

package app

import (
	"net/http"
	"testing"

	"enx-api/utils/sqlitex"
)

// No subscription metadata is present on the invoice: attribution must come
// from the Checkout association committed by the preceding worker pass.
const paidInvoice = `{"object":"invoice","id":"in_checkout","customer":"cus_topup","billing_reason":"subscription_create","amount_paid":2000,"parent":{"subscription_details":{"subscription":"sub_recovery"}},"lines":{"has_more":false,"data":[{"id":"il_checkout","amount":2000,"parent":{"subscription_item_details":{"subscription":"sub_recovery","subscription_item":"si_checkout","proration":false}},"pricing":{"price_details":{"price":"price_pp_m"}},"period":{"start":1790000000,"end":1800000000}}]}}`

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
