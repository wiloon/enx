package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/billingsupport"
	"enx-api/billing/conflict"
	"enx-api/utils/sqlitex"
)

// setSupportAlert stores a as subscriptionID's support alert.
func setSupportAlert(t *testing.T, subscriptionID string, a alert.Alert) {
	t.Helper()
	if err := sqlitex.DB.Exec("UPDATE subscriptions SET support_alert_state = ?, support_alert_attempts = ?, "+
		"support_alert_last_error = ?, support_alert_next_attempt_at = ?, support_alert_sent_at = ?, "+
		"support_alert_claim_token = ?, support_alert_claim_expires_at = ? WHERE stripe_subscription_id = ?",
		string(a.State), a.Attempts, a.LastError, unixMilliOrNil(a.NextAttemptAt), unixMilliOrNil(a.SentAt),
		a.ClaimToken, unixMilliOrNil(a.ClaimExpiresAt), subscriptionID).Error; err != nil {
		t.Fatalf("set support alert of %s: %v", subscriptionID, err)
	}
}

// supportRecordEqual compares instants, not time.Time representations.
func supportRecordEqual(a, b billingsupport.Record) bool {
	if !a.Subscription.Support.At.Equal(b.Subscription.Support.At) || !alertEqual(a.Alert, b.Alert) {
		return false
	}
	a.Subscription.Support.At, b.Subscription.Support.At = time.Time{}, time.Time{}
	return a.Version == b.Version && a.Subscription == b.Subscription
}

func alertEqual(a, b alert.Alert) bool {
	return a.State == b.State && a.Attempts == b.Attempts && a.LastError == b.LastError &&
		a.NextAttemptAt.Equal(b.NextAttemptAt) && a.SentAt.Equal(b.SentAt) &&
		a.ClaimToken == b.ClaimToken && a.ClaimExpiresAt.Equal(b.ClaimExpiresAt)
}

func TestBillingSupportSubscriptionReadsTheRowWithItsVersionSupportRequestAndAlert(t *testing.T) {
	newSubscriptionConflictDB(t)
	asked := discoveredT0.Add(time.Hour)
	withSupport := openConflict("sub_b", discoveredT0)
	withSupport.Version, withSupport.SupportMessage, withSupport.SupportAt = 4, "I was charged twice.", asked
	seedSubscription(t, withSupport)
	supportAlert := alert.Alert{State: alert.Sent, Attempts: 2, LastError: "timeout", NextAttemptAt: asked,
		SentAt: asked.Add(time.Minute), ClaimToken: "tok", ClaimExpiresAt: asked.Add(2 * time.Minute)}
	setSupportAlert(t, "sub_b", supportAlert)
	resolved := openConflict("sub_c", discoveredT0)
	resolved.ConflictStatus, resolved.ResolverID, resolved.ResolvedAt, resolved.Notes =
		conflict.Resolved, "admin_1", discoveredT0.Add(2*time.Hour), "Refunded in Stripe."
	seedSubscription(t, resolved)
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
	seedSubscription(t, subscriptionRow{ID: "sub_u", CustomerID: "cus_u", Status: "active"})

	for _, tc := range []struct {
		id   string
		want billingsupport.Record
	}{
		{"sub_b", billingsupport.Record{Version: 4, Subscription: conflict.Subscription{OwnerID: "user_1", Conflict: true,
			Support: conflict.Support{Message: "I was charged twice.", At: asked}}, Alert: supportAlert}},
		{"sub_c", billingsupport.Record{Version: 1, Subscription: conflict.Subscription{OwnerID: "user_1", Conflict: true}}},
		{"sub_a", billingsupport.Record{Version: 1, Subscription: conflict.Subscription{OwnerID: "user_1"}}},
		{"sub_u", billingsupport.Record{Version: 1}},
	} {
		got, err := BillingSupport{}.Subscription(context.Background(), tc.id)
		if err != nil {
			t.Fatalf("Subscription(%s): %v", tc.id, err)
		}
		if !supportRecordEqual(got, tc.want) {
			t.Errorf("Subscription(%s) = %+v, want %+v", tc.id, got, tc.want)
		}
	}
}

func TestBillingSupportSaveSupportStoresTheRequestAndItsAlertAtTheVersionRead(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 7)
	row := openConflict("sub_b", discoveredT0)
	row.Version = 3
	seedSubscription(t, row)
	ctx := context.Background()
	store := BillingSupport{}
	asked := discoveredT0.Add(time.Hour)
	support := conflict.Support{Message: "I was charged twice.", At: asked}
	raised := alert.Alert{State: alert.Pending, NextAttemptAt: asked}

	if err := store.SaveSupport(ctx, billingsupport.Save{SubscriptionID: "sub_b", Version: 3, Support: support, Alert: raised}); err != nil {
		t.Fatalf("SaveSupport: %v", err)
	}

	got, err := store.Subscription(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	want := billingsupport.Record{Version: 4, Subscription: conflict.Subscription{OwnerID: "user_1", Conflict: true, Support: support}, Alert: raised}
	if !supportRecordEqual(got, want) {
		t.Errorf("after the save = %+v, want %+v", got, want)
	}
	if state := conflictAlertState(t, "sub_b"); state != "pending" {
		t.Errorf("conflict alert = %q after the support request, want still pending", state)
	}
	if v := ownerBillingVersion(t, "user_1"); v != 7 {
		t.Errorf("owner's billing_version = %d after the support request, want unchanged 7", v)
	}

	other := billingsupport.Save{SubscriptionID: "sub_b", Version: 3,
		Support: conflict.Support{Message: "Me too.", At: asked.Add(time.Minute)}, Alert: alert.Alert{State: alert.Pending, NextAttemptAt: asked.Add(time.Minute)}}
	if err := store.SaveSupport(ctx, other); !errors.Is(err, billingsupport.ErrStale) {
		t.Fatalf("SaveSupport at the old version = %v, want billingsupport.ErrStale", err)
	}
	again, err := store.Subscription(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	if !supportRecordEqual(again, want) {
		t.Errorf("after the stale save = %+v, want unchanged %+v", again, want)
	}
	if err := store.SaveSupport(ctx, billingsupport.Save{SubscriptionID: "sub_missing", Version: 1, Support: support, Alert: raised}); !errors.Is(err, billingsupport.ErrStale) {
		t.Errorf("SaveSupport of a missing row = %v, want billingsupport.ErrStale", err)
	}
}

func TestBillingSupportAUsersFirstRequestStandsAndARepeatRaisesNothing(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	ctx := context.Background()
	asked := discoveredT0.Add(time.Hour)
	at := asked
	svc := billingsupport.New(BillingSupport{}, func() time.Time { return at })

	first, err := svc.Request(ctx, "user_1", "sub_b", "  I was charged twice.\n")
	if err != nil {
		t.Fatalf("Request: %v", err)
	}
	stored, err := BillingSupport{}.Subscription(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	want := billingsupport.Record{Version: 2, Subscription: conflict.Subscription{OwnerID: "user_1", Conflict: true,
		Support: conflict.Support{Message: "I was charged twice.", At: asked}}, Alert: alert.Alert{State: alert.Pending, NextAttemptAt: asked}}
	if !supportRecordEqual(stored, want) {
		t.Errorf("stored = %+v, want %+v", stored, want)
	}

	at = asked.Add(time.Hour)
	again, err := svc.Request(ctx, "user_1", "sub_b", "Hello again?")
	if err != nil || again.Message != first.Message || !again.At.Equal(first.At) {
		t.Errorf("repeated Request = %+v, %v; want the first request %+v", again, err, first)
	}
	if _, err := svc.Request(ctx, "user_2", "sub_b", "Not mine."); !errors.Is(err, conflict.ErrNotOwnedConflict) {
		t.Errorf("another user's Request = %v, want conflict.ErrNotOwnedConflict", err)
	}
	if _, err := svc.Request(ctx, "user_1", "sub_missing", "Help."); !errors.Is(err, conflict.ErrNotOwnedConflict) {
		t.Errorf("Request for an unknown subscription = %v, want conflict.ErrNotOwnedConflict", err)
	}
	after, err := BillingSupport{}.Subscription(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	if !supportRecordEqual(after, want) {
		t.Errorf("after the repeats = %+v, want unchanged %+v", after, want)
	}
}

func TestBillingSupportSubscriptionENXHasNoRowForIsNotFound(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedSubscription(t, openConflict("sub_b", discoveredT0))

	if _, err := (BillingSupport{}).Subscription(context.Background(), "sub_missing"); !errors.Is(err, billingsupport.ErrNotFound) {
		t.Errorf("Subscription(sub_missing) = %v, want billingsupport.ErrNotFound", err)
	}
}
