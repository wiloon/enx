//go:build integration

package repo

import (
	"context"
	"testing"
	"time"

	"enx-api/billing/invoicepaid"
	"enx-api/billing/webhookevent"
)

func TestPaidInvoiceSnapshotFailureRollsBackPaymentAndTaskThenRetriesOnce(t *testing.T) {
	newInvoiceDB(t)
	store := NewWebhookEvents(WebhookEffects{Referral: referralTerms}.Apply)
	read := claimedTask(t, store)
	next, err := webhookevent.Complete(read, "tok_a", receiptT0.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	effects := invoicepaid.LiveEffects{Invoice: normalGrantEffects(0, "in_live"), Snapshot: maxScheduledDown("sub_new", true, 1)}
	execAll(t, `CREATE TRIGGER fail_paid_snapshot BEFORE UPDATE OF price_id ON subscriptions BEGIN SELECT RAISE(ABORT, 'snapshot unavailable'); END`)
	if err := store.Save(context.Background(), sandboxScope, read, next, effects); err == nil {
		t.Fatal("expected snapshot write failure")
	}
	if got := poolBalanceOf(t, "u_topup"); got != 0 {
		t.Fatalf("partial balance %d", got)
	}
	if grants := subscriptionGrants(t, "u_topup"); len(grants) != 0 {
		t.Fatalf("partial ledger: %+v", grants)
	}
	snapshot, _ := readSnapshot(t, "sub_new")
	if snapshot.Classification != "" || snapshot.Version != 1 || billingVersion(t, "u_topup") != 0 {
		t.Fatalf("partial acceptance: %+v", snapshot)
	}
	if got := unfinished(t, store)["evt_1"].Task; got.Status != read.Status || got.ClaimToken != read.ClaimToken {
		t.Fatalf("partial task: %+v", got)
	}
	execAll(t, "DROP TRIGGER fail_paid_snapshot")
	if err := store.Save(context.Background(), sandboxScope, read, next, effects); err != nil {
		t.Fatal(err)
	}
	if got := poolBalanceOf(t, "u_topup"); got != 1000 {
		t.Fatalf("balance = %d", got)
	}
	if grants := subscriptionGrants(t, "u_topup"); len(grants) != 1 {
		t.Fatalf("ledger = %+v", grants)
	}
	saved, _ := readSnapshot(t, "sub_new")
	if saved.Status != "past_due" || saved.Plan != "max" || saved.PriceID != "price_max" || saved.CurrentPeriodEnd != 1795507901 || saved.CancelAt != 1795507901 || !saved.PendingUpdate || !saved.HasSchedule {
		t.Fatalf("snapshot = %+v", saved)
	}
	if err := store.Save(context.Background(), sandboxScope, read, next, effects); err == nil {
		t.Fatal("stale claim replay succeeded")
	}
	if grants := subscriptionGrants(t, "u_topup"); len(grants) != 1 {
		t.Fatalf("replayed ledger: %+v", grants)
	}
}

func TestPaidInvoiceRejectsSnapshotChangedAfterAssessment(t *testing.T) {
	newInvoiceDB(t)
	store := NewWebhookEvents(WebhookEffects{Referral: referralTerms}.Apply)
	read := claimedTask(t, store)
	next, err := webhookevent.Complete(read, "tok_a", receiptT0.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	effects := invoicepaid.LiveEffects{Invoice: normalGrantEffects(0, "in_stale"), Snapshot: maxScheduledDown("sub_new", true, 1)}
	changed := maxScheduledDown("sub_new", true, 1)
	changed.State.Status = "canceled"
	if err := applySnapshot(t, changed); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(context.Background(), sandboxScope, read, next, effects); err == nil {
		t.Fatal("stale assessment was committed")
	}
	saved, _ := readSnapshot(t, "sub_new")
	if saved.Status != "canceled" || saved.Classification != "" {
		t.Fatalf("stale write: %+v", saved)
	}
	if got := poolBalanceOf(t, "u_topup"); got != 0 {
		t.Fatalf("stale grant = %d", got)
	}
	if grants := subscriptionGrants(t, "u_topup"); len(grants) != 0 {
		t.Fatalf("stale ledger: %+v", grants)
	}
}
