package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// storedSnapshot is a subscriptions row as the snapshot tests read it back.
type storedSnapshot struct {
	UserID            string
	Unowned           bool
	StripeCustomerID  string
	Status            string
	Plan              string
	PriceID           string
	CurrentPeriodEnd  int64
	CancelAtPeriodEnd bool
	CancelAt          int64
	PendingUpdate     bool
	HasSchedule       bool
	Classification    string
	Version           int64
	ConflictStatus    string
	ConflictNotes     string
}

func readSnapshot(t *testing.T, id string) (storedSnapshot, bool) {
	t.Helper()
	var rows []storedSnapshot
	if err := sqlitex.DB.Raw("SELECT COALESCE(user_id, '') AS user_id, user_id IS NULL AS unowned, stripe_customer_id, status, plan, "+
		"price_id, COALESCE(current_period_end, 0) AS current_period_end, "+
		"cancel_at_period_end, cancel_at, pending_update, has_schedule, classification, version, conflict_status, conflict_notes "+
		"FROM subscriptions WHERE stripe_subscription_id = ?", id).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return storedSnapshot{}, false
	}
	return rows[0], true
}

// maxScheduledDown is Stripe's state after an upgrade to Max with a Portal
// downgrade scheduled at period end and a Portal cancellation set.
func maxScheduledDown(id string, known bool, version int64) snapshot.Effects {
	return snapshot.Effects{
		SubscriptionID: id, Known: known, Version: version, CustomerID: "cus_" + id,
		State: eligibility.Live{
			Status: "past_due", CurrentPeriodEnd: 1795507901, CancelAt: 1795507901,
			PendingUpdate: true, HasSchedule: true,
		},
		PriceID: "price_max", Tier: "max",
	}
}

func applySnapshot(t *testing.T, e snapshot.Effects) error {
	t.Helper()
	return sqlitex.DB.Transaction(func(tx *gorm.DB) error { return ApplySnapshot(tx, e) })
}

func TestSubscriptionSnapshotsReadsWhetherENXHasTheRowAndItsVersion(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	if err := sqlitex.DB.Exec("UPDATE subscriptions SET version = 6 WHERE stripe_subscription_id = 'sub_b'").Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	got, err := SubscriptionSnapshots{}.Subscription(ctx, "sub_b")
	if err != nil || got != (snapshot.Subscription{Known: true, Version: 6}) {
		t.Errorf("Subscription(sub_b) = %+v, %v; want known at version 6", got, err)
	}
	got, err = SubscriptionSnapshots{}.Subscription(ctx, "sub_missing")
	if err != nil || got != (snapshot.Subscription{}) {
		t.Errorf("Subscription(sub_missing) = %+v, %v; want unknown", got, err)
	}
}

func TestApplySnapshotRefreshesTheSnapshotOnlyAndMovesTheVersionOn(t *testing.T) {
	// A conflict row: the refresh is financial context and must leave its
	// owner, Customer, classification and investigation alone.
	newSubscriptionConflictDB(t)
	row := openConflict("sub_b", discoveredT0)
	row.Notes, row.Version = "Checked in Stripe.", 3
	seedSubscription(t, row)

	e := maxScheduledDown("sub_b", true, 3)
	e.CustomerID = "cus_other"
	if err := applySnapshot(t, e); err != nil {
		t.Fatalf("ApplySnapshot: %v", err)
	}

	got, _ := readSnapshot(t, "sub_b")
	want := storedSnapshot{
		UserID: "user_1", StripeCustomerID: "cus_sub_b",
		Status: "past_due", Plan: "max", PriceID: "price_max", CurrentPeriodEnd: 1795507901,
		CancelAt: 1795507901, PendingUpdate: true, HasSchedule: true,
		Classification: "conflict", Version: 4, ConflictStatus: "open", ConflictNotes: "Checked in Stripe.",
	}
	if got != want {
		t.Errorf("row = %+v\nwant %+v", got, want)
	}
}

func TestApplySnapshotOfASubscriptionENXHadNoneOfCreatesItUnattributed(t *testing.T) {
	// subscription-before-checkout: no owner and no classification until a
	// Checkout or a paid invoice attributes it.
	newSubscriptionConflictDB(t)

	if err := applySnapshot(t, maxScheduledDown("sub_new", false, 0)); err != nil {
		t.Fatalf("ApplySnapshot: %v", err)
	}

	got, ok := readSnapshot(t, "sub_new")
	if !ok {
		t.Fatal("no row for sub_new after the snapshot")
	}
	want := storedSnapshot{
		Unowned: true, StripeCustomerID: "cus_sub_new",
		Status: "past_due", Plan: "max", PriceID: "price_max", CurrentPeriodEnd: 1795507901,
		CancelAt: 1795507901, PendingUpdate: true, HasSchedule: true, Version: 1,
	}
	if got != want {
		t.Errorf("row = %+v\nwant %+v", got, want)
	}
	if read, err := (SubscriptionSnapshots{}).Subscription(context.Background(), "sub_new"); err != nil || !read.Known {
		t.Errorf("Subscription(sub_new) = %+v, %v; want known", read, err)
	}
}

func TestApplySnapshotChangesNothingOnceTheRowMovedOrAppeared(t *testing.T) {
	cases := []struct {
		name    string
		effects snapshot.Effects
	}{
		{"the row moved on since it was read", maxScheduledDown("sub_b", true, 2)},
		{"a row was created since it was read as absent", maxScheduledDown("sub_b", false, 0)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			row := openConflict("sub_b", discoveredT0)
			row.Version = 3
			seedSubscription(t, row)
			before, _ := readSnapshot(t, "sub_b")

			err := applySnapshot(t, tc.effects)

			if !errors.Is(err, snapshot.ErrStale) {
				t.Errorf("ApplySnapshot = %v, want snapshot.ErrStale", err)
			}
			if after, _ := readSnapshot(t, "sub_b"); after != before {
				t.Errorf("row = %+v after a stale snapshot, want unchanged %+v", after, before)
			}
		})
	}
}

func TestApplySnapshotOfAKnownRowENXNoLongerHasIsStale(t *testing.T) {
	newSubscriptionConflictDB(t)

	err := applySnapshot(t, maxScheduledDown("sub_gone", true, 1))

	if !errors.Is(err, snapshot.ErrStale) {
		t.Errorf("ApplySnapshot = %v, want snapshot.ErrStale", err)
	}
	if _, ok := readSnapshot(t, "sub_gone"); ok {
		t.Error("a stale snapshot of a known row created it")
	}
}

// A stored status is the deletion check's ended evidence (eligibility.
// NeedsLiveLookup), so a decision that read the owner before the status
// changed must not apply after it. A refresh that keeps the status changes
// no acceptance-relevant data and leaves the revision alone.
func TestApplySnapshotMovesTheOwnersBillingRevisionOnWhenTheStatusChanges(t *testing.T) {
	cases := []struct {
		name   string
		status string
		want   int64
	}{
		{"the status changes", "canceled", 8},
		{"only the schedule and Price change", "active", 7},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedBillingOwner(t, "user_1", 7)
			seedBillingOwner(t, "user_2", 4)
			seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})

			e := maxScheduledDown("sub_a", true, 1)
			e.State.Status = tc.status
			if err := applySnapshot(t, e); err != nil {
				t.Fatalf("ApplySnapshot: %v", err)
			}

			if v := ownerBillingVersion(t, "user_1"); v != tc.want {
				t.Errorf("owner's billing_version = %d, want %d", v, tc.want)
			}
			if v := ownerBillingVersion(t, "user_2"); v != 4 {
				t.Errorf("another user's billing_version = %d, want unchanged 4", v)
			}
		})
	}
}

// claimedSnapshotTask receives a customer.subscription.updated event for
// subscriptionID and has worker tok_a claim it.
func claimedSnapshotTask(t *testing.T, store WebhookEvents, subscriptionID string) webhookevent.Task {
	t.Helper()
	d := paidInvoiceDelivery("dlv_1", sandboxScope, receiptT0)
	d.Receipt.Envelope.Type = "customer.subscription.updated"
	if err := (WebhookReceipts{}).Record(context.Background(), d,
		webhookevent.NewTask("customer.subscription.updated", subscriptionID, receiptT0)); err != nil {
		t.Fatal(err)
	}
	read := unfinished(t, store)["evt_1"].Task
	claimed, err := webhookevent.ClaimTask(read, "tok_a", receiptT0.Add(time.Minute), 2*time.Minute, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(context.Background(), sandboxScope, read, claimed, nil); err != nil {
		t.Fatal(err)
	}
	return claimed
}

func TestWebhookEventsSaveCommitsASnapshotWithItsTaskOrNeither(t *testing.T) {
	t.Run("the row is still as read", func(t *testing.T) {
		newSubscriptionConflictDB(t)
		seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
		store := NewWebhookEvents(ApplyWebhookEffects)
		claimed := claimedSnapshotTask(t, store, "sub_a")
		done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(2*time.Minute))

		if err := store.Save(context.Background(), sandboxScope, claimed, done, maxScheduledDown("sub_a", true, 1)); err != nil {
			t.Fatalf("Save: %v", err)
		}

		if got := unfinished(t, store); len(got) != 0 {
			t.Errorf("unfinished tasks = %v, want the event processed", got)
		}
		if row, _ := readSnapshot(t, "sub_a"); row.Plan != "max" || row.Version != 2 {
			t.Errorf("row plan=%q version=%d, want the snapshot applied at version 2", row.Plan, row.Version)
		}
	})
	t.Run("the row moved on since it was read", func(t *testing.T) {
		newSubscriptionConflictDB(t)
		seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted", Version: 2})
		store := NewWebhookEvents(ApplyWebhookEffects)
		claimed := claimedSnapshotTask(t, store, "sub_a")
		done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(2*time.Minute))

		err := store.Save(context.Background(), sandboxScope, claimed, done, maxScheduledDown("sub_a", true, 1))

		if !errors.Is(err, snapshot.ErrStale) {
			t.Errorf("Save = %v, want snapshot.ErrStale", err)
		}
		if got := unfinished(t, store)["evt_1"].Task; got.Status != webhookevent.Processing || got.ClaimToken != "tok_a" {
			t.Errorf("task = %s claimed by %q, want still processing under tok_a", got.Status, got.ClaimToken)
		}
		if row, _ := readSnapshot(t, "sub_a"); row.Plan != "pro" || row.Version != 2 {
			t.Errorf("row plan=%q version=%d, want unchanged pro at version 2", row.Plan, row.Version)
		}
	})
}

func TestApplyWebhookEffectsRefusesEffectsItHasNoApplierFor(t *testing.T) {
	newSubscriptionConflictDB(t)

	err := sqlitex.DB.Transaction(func(tx *gorm.DB) error { return ApplyWebhookEffects(tx, sandboxScope, grantEffect{invoice: "in_1"}) })

	if err == nil {
		t.Error("ApplyWebhookEffects of an unknown effect = nil, want an error")
	}
}
