//go:build integration

package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/chargerefunded"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/credit"
	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
	"enx-api/billing/invoicepaid"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// ADR-063 Decisions 7-9: every ledger row the webhook writers and the credit
// functions write records the three-pool total after it, so each row's
// amount is the change in that total across it.

type totalRow struct {
	ID      string
	Type    string
	Feature string
	Amount  int64
	Total   *int64
}

func ledgerTotals(t *testing.T, userID string) []totalRow {
	t.Helper()
	var rows []totalRow
	if err := sqlitex.DB.Raw("SELECT id, type, feature, amount, total_balance_after AS total FROM credit_transactions "+
		"WHERE user_id = ? ORDER BY rowid", userID).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

// assertReconciles checks each row's amount against the change in the
// total, starting from start.
func assertReconciles(t *testing.T, start int64, rows []totalRow) {
	t.Helper()
	prev := start
	for i, r := range rows {
		if r.Total == nil {
			t.Fatalf("row %d (%s) has no total_balance_after", i, r.Type)
		}
		if r.Amount != *r.Total-prev {
			t.Errorf("row %d (%s %s): amount %d, but the total moved %d -> %d", i, r.Type, r.Feature, r.Amount, prev, *r.Total)
		}
		prev = *r.Total
	}
}

func rowKinds(rows []totalRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Type
		if r.Feature != "" {
			out[i] += ":" + r.Feature
		}
	}
	return out
}

func equalKinds(rows []totalRow, want ...string) bool {
	got := rowKinds(rows)
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// applyLive applies with a clock of the real time, so the credit
// functions' own clock and the webhook writers agree on the trial.
func applyLive(t *testing.T, eventID string, effects webhookevent.Effects) error {
	t.Helper()
	return sqlitex.DB.Transaction(func(tx *gorm.DB) error {
		return WebhookEffects{Now: time.Now, Referral: referralTerms}.Apply(tx, eventScope(eventID), effects)
	})
}

var periodTwo = invoice.Period{Start: periodOne.End, End: periodOne.End + 2592000}

func subscriptionGrant(revision, version int64, accepted string, kind invoicepaid.GrantKind, invoiceID string, period invoice.Period, applied int64) invoicepaid.Effects {
	return invoicepaid.Effects{
		Observed: invoicepaid.Observed{
			SubscriptionID: "sub_new", SubscriptionKnown: true, SubscriptionVersion: version, OwnerUserID: "u_topup", AcceptedID: accepted, Revision: revision,
		},
		Grant: &invoicepaid.Grant{
			Kind: kind, InvoiceID: invoiceID, PaymentIntentID: "pi_" + invoiceID, Tier: "pro",
			Source: creditperiod.Source{SubscriptionID: "sub_new", Period: period}, Purchased: 1000, Applied: applied,
		},
	}
}

func TestLedgerTotalsReconcileAcrossTheWholeCreditLifecycle(t *testing.T) {
	newInvoiceDB(t)
	execAll(t, "DELETE FROM credit_transactions WHERE user_id = 'u_topup'", "UPDATE credit_accounts SET topup_balance = 0 WHERE user_id = 'u_topup'")
	ctx := context.Background()
	must := func(step string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", step, err)
		}
	}

	_, err := credit.GrantTrial(ctx, "u_topup", "hmac_topup", 100, time.Hour)
	must("trial", err)
	topUp := topUpEffects(billingVersion(t, "u_topup"), "cs_seq")
	topUp.FirstPayment = nil
	must("top-up", applyLive(t, "evt_topup", topUp))
	must("AI use", credit.Settle(ctx, "u_topup", "translate_sentence", 30))
	first := subscriptionGrant(billingVersion(t, "u_topup"), 1, "", invoicepaid.NormalGrant, "in_1", periodOne, 1000)
	first.Classification = &invoicepaid.Classification{To: acceptance.Accepted}
	must("subscription grant", applyLive(t, "evt_in_1", first))
	must("AI use into the subscription", credit.Settle(ctx, "u_topup", "translate_sentence", 100))
	must("renewal", applyLive(t, "evt_in_2", subscriptionGrant(billingVersion(t, "u_topup"), 2, "sub_new", invoicepaid.NormalGrant, "in_2", periodTwo, 1000)))
	must("upgrade top-up", applyLive(t, "evt_in_up", subscriptionGrant(billingVersion(t, "u_topup"), 2, "sub_new", invoicepaid.UpgradeTopUp, "in_up", periodTwo, 500)))
	must("zero-applied grant", applyLive(t, "evt_in_late", subscriptionGrant(billingVersion(t, "u_topup"), 2, "sub_new", invoicepaid.NormalGrant, "in_late", periodTwo, 0)))
	must("admin deduction", credit.DeductAdmin(ctx, "u_topup", 200, "correction"))
	rows := ledgerTotals(t, "u_topup")
	refund := chargerefunded.Effects{
		Observed: chargerefunded.Observed{UserID: "u_topup", Revision: billingVersion(t, "u_topup"), GrantID: rows[1].ID},
		Clawback: &chargerefunded.Clawback{
			GrantID: rows[1].ID, UserID: "u_topup", Pool: chargerefunded.PoolTopUp, Credits: 500,
			ChargeID: "ch_seq", Refunded: 1000, Captured: 1000,
		},
	}
	must("refund clawback", applyLive(t, "evt_refund", refund))

	rows = ledgerTotals(t, "u_topup")
	if !equalKinds(rows, "GRANT_TRIAL", "GRANT_TOPUP", "SETTLE:translate_sentence", "GRANT_SUBSCRIPTION",
		"SETTLE:translate_sentence", "EXPIRE:subscription", "GRANT_SUBSCRIPTION", "GRANT_SUBSCRIPTION", "GRANT_SUBSCRIPTION",
		"DEDUCT_ADMIN", "CLAWBACK") {
		t.Fatalf("ledger = %v", rowKinds(rows))
	}
	assertReconciles(t, 0, rows)
	var totals []int64
	for _, r := range rows {
		totals = append(totals, *r.Total)
	}
	want := []int64{100, 600, 570, 1570, 1470, 500, 1500, 2000, 2000, 1800, 1300}
	for i := range want {
		if totals[i] != want[i] {
			t.Fatalf("totals = %v, want %v", totals, want)
		}
	}
	if rows[5].Amount != -970 {
		t.Errorf("subscription expiry = %d, want the leftover 970", rows[5].Amount)
	}
}

func TestRenewalWithNoLeftoverWritesNoSubscriptionExpiry(t *testing.T) {
	newInvoiceDB(t)
	if err := applyLive(t, "evt_in_1", subscriptionGrant(0, 1, "", invoicepaid.NormalGrant, "in_1", periodOne, 1000)); err != nil {
		t.Fatalf("first grant: %v", err)
	}
	execAll(t, "UPDATE credit_accounts SET subscription_balance = 0 WHERE user_id = 'u_topup'")

	if err := applyLive(t, "evt_in_2", subscriptionGrant(1, 1, "", invoicepaid.NormalGrant, "in_2", periodTwo, 1000)); err != nil {
		t.Fatalf("renewal: %v", err)
	}

	for _, r := range ledgerTotals(t, "u_topup") {
		if r.Type == "EXPIRE" {
			t.Errorf("ledger has %s:%s, want no expiry of an empty pool", r.Type, r.Feature)
		}
	}
}

// expireTrialOfTopUpUser gives u_topup a trial of 100 that expired before both the
// real clock and receiptT0.
func expireTrialOfTopUpUser(t *testing.T) {
	t.Helper()
	execAll(t, "UPDATE credit_accounts SET trial_balance = 100, trial_expires_at = 1700000000 WHERE user_id = 'u_topup'")
}

func TestFirstWriteAfterTrialExpiryForfeitsTheTrialFirst(t *testing.T) {
	cases := []struct {
		name  string
		write func(t *testing.T) error
		kind  string
		total int64
	}{
		{"a top-up", func(t *testing.T) error {
			e := topUpEffects(0, "cs_after")
			e.FirstPayment = nil
			return applyCheckout(t, "evt_topup", e)
		}, "GRANT_TOPUP", 800},
		{"a subscription grant", func(t *testing.T) error {
			return applyInvoice(t, "evt_in_1", subscriptionGrant(0, 1, "", invoicepaid.NormalGrant, "in_1", periodOne, 1000))
		}, "GRANT_SUBSCRIPTION", 1300},
		{"a refund clawback", func(t *testing.T) error {
			return sqlitex.DB.Transaction(func(tx *gorm.DB) error {
				return WebhookEffects{Now: func() time.Time { return receiptT0 }}.Apply(tx, eventScope("evt_refund"), topUpClawback(100))
			})
		}, "CLAWBACK", 200},
		{"an admin grant", func(t *testing.T) error {
			return credit.GrantAdmin(context.Background(), "u_topup", 50, "goodwill")
		}, "GRANT_ADMIN", 350},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			newInvoiceDB(t)
			expireTrialOfTopUpUser(t)

			if err := c.write(t); err != nil {
				t.Fatalf("write: %v", err)
			}

			rows := ledgerTotals(t, "u_topup")[1:] // after the fixture's grant
			if !equalKinds(rows, "EXPIRE:trial", c.kind) {
				t.Fatalf("ledger = %v, want the trial's expiry, then %s", rowKinds(rows), c.kind)
			}
			assertReconciles(t, 400, rows)
			if got := *rows[1].Total; got != c.total {
				t.Errorf("total after the write = %d, want %d", got, c.total)
			}
		})
	}
}

func TestAStaleWebhookWriteAfterTrialExpiryForfeitsNothing(t *testing.T) {
	newInvoiceDB(t)
	expireTrialOfTopUpUser(t)
	execAll(t, "UPDATE users SET billing_version = 3 WHERE id = 'u_topup'")

	if err := applyInvoice(t, "evt_in_1", subscriptionGrant(0, 1, "", invoicepaid.NormalGrant, "in_1", periodOne, 1000)); !errors.Is(err, invoicepaid.ErrStale) {
		t.Fatalf("apply = %v, want ErrStale", err)
	}
	e := topUpEffects(0, "cs_stale")
	e.FirstPayment = nil
	if err := applyCheckout(t, "evt_topup", e); !errors.Is(err, checkoutcompleted.ErrStale) {
		t.Fatalf("apply top-up = %v, want ErrStale", err)
	}

	if rows := ledgerTotals(t, "u_topup"); len(rows) != 1 {
		t.Errorf("ledger = %v, want only the fixture's grant", rowKinds(rows))
	}
	var trial int64
	if err := sqlitex.DB.Raw("SELECT trial_balance FROM credit_accounts WHERE user_id = 'u_topup'").Scan(&trial).Error; err != nil || trial != 100 {
		t.Errorf("trial balance = %d, %v; want 100 untouched", trial, err)
	}
}

func TestWebhookEventsSaveRollsTheTrialExpiryBackWithAFailedEffect(t *testing.T) {
	newInvoiceDB(t)
	expireTrialOfTopUpUser(t)
	// The zero WebhookEffects has no referral policy, so the first-payment
	// handoff fails after the expiry and the grant were written.
	store := NewWebhookEvents(ApplyWebhookEffects)
	read := claimedTask(t, store)
	next, err := webhookevent.Complete(read, "tok_a", receiptT0.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	if err := store.Save(context.Background(), sandboxScope, read, next, normalGrantEffects(0, "in_1")); err == nil {
		t.Fatal("Save = nil, want the first-payment handoff to fail")
	}

	if rows := ledgerTotals(t, "u_topup"); len(rows) != 1 {
		t.Errorf("ledger = %v, want the expiry and the grant rolled back", rowKinds(rows))
	}
	var trial int64
	if err := sqlitex.DB.Raw("SELECT trial_balance FROM credit_accounts WHERE user_id = 'u_topup'").Scan(&trial).Error; err != nil || trial != 100 {
		t.Errorf("trial balance = %d, %v; want 100 restored", trial, err)
	}
}

// ADR-063 Decision 7, revised in #668: deletion forfeits balances without a
// ledger row, so the refund after it starts again from 0 rather than from
// the last retained total.
func TestApplyClawbackAfterDeletionRecordsATotalOfZero(t *testing.T) {
	newSubscriptionConflictDB(t, "deleted-user.sql")
	execAll(t, "INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, total_balance_after, feature, created_at) "+
		"VALUES ('tx_deleted_settle', 'u_deleted', 'SETTLE', -10, 90, 90, 'translate_sentence', 1784000000000)")
	e := chargerefunded.Effects{
		Observed: chargerefunded.Observed{UserID: "u_deleted", GrantID: "tx_deleted_grant", Taken: 100},
		Clawback: &chargerefunded.Clawback{
			GrantID: "tx_deleted_grant", UserID: "u_deleted", Pool: chargerefunded.PoolSubscription,
			ChargeID: "ch_deleted", Refunded: 1000, Captured: 1000,
		},
	}

	if err := applyClawback(t, eventScope("evt_late_refund"), e); err != nil {
		t.Fatalf("ApplyClawback: %v", err)
	}

	rows := ledgerTotals(t, "u_deleted")
	last := rows[len(rows)-1]
	if last.Type != "CLAWBACK" || last.Amount != 0 || last.Total == nil || *last.Total != 0 {
		t.Fatalf("refund row = %+v, want a zero-effect CLAWBACK with a total of 0", last)
	}
	if prev := rows[len(rows)-2]; prev.Total == nil || *prev.Total != 90 {
		t.Errorf("last pre-deletion row = %+v, want its retained total of 90 left as it was", prev)
	}
	if n := countRows(t, "credit_accounts", "user_id", "u_deleted"); n != 0 {
		t.Errorf("%d credit accounts for the deleted user, want none recreated", n)
	}
}
