package repo

import (
	"context"
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"
)

// setEventAlert stores a as scope's event attention alert, with the task's
// last error as its reason.
func setEventAlert(t *testing.T, scope webhookevent.Scope, reason string, a alert.Alert) {
	t.Helper()
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET status = 'needs_attention', last_error = ?, alert_state = ?, "+
		"alert_attempts = ?, alert_last_error = ?, alert_next_attempt_at = ?, alert_sent_at = ?, alert_claim_token = ?, "+
		"alert_claim_expires_at = ? WHERE stripe_account_id = ? AND livemode = ? AND event_id = ?",
		reason, string(a.State), a.Attempts, a.LastError, unixMilliOrNil(a.NextAttemptAt), unixMilliOrNil(a.SentAt),
		a.ClaimToken, unixMilliOrNil(a.ClaimExpiresAt), scope.AccountID, scope.Livemode, scope.EventID).Error; err != nil {
		t.Fatalf("set event alert of %s: %v", scope.EventID, err)
	}
}

// setConflictAlert stores a as subscriptionID's conflict alert.
func setConflictAlert(t *testing.T, subscriptionID string, a alert.Alert) {
	t.Helper()
	if err := sqlitex.DB.Exec("UPDATE subscriptions SET conflict_alert_state = ?, conflict_alert_attempts = ?, "+
		"conflict_alert_last_error = ?, conflict_alert_next_attempt_at = ?, conflict_alert_sent_at = ?, "+
		"conflict_alert_claim_token = ?, conflict_alert_claim_expires_at = ? WHERE stripe_subscription_id = ?",
		string(a.State), a.Attempts, a.LastError, unixMilliOrNil(a.NextAttemptAt), unixMilliOrNil(a.SentAt),
		a.ClaimToken, unixMilliOrNil(a.ClaimExpiresAt), subscriptionID).Error; err != nil {
		t.Fatalf("set conflict alert of %s: %v", subscriptionID, err)
	}
}

func subscriptionVersion(t *testing.T, subscriptionID string) int64 {
	t.Helper()
	var v int64
	if err := sqlitex.DB.Raw("SELECT version FROM subscriptions WHERE stripe_subscription_id = ?", subscriptionID).Scan(&v).Error; err != nil {
		t.Fatal(err)
	}
	return v
}

// pendingByRef reads the store's pending alerts keyed by their Ref.
func pendingByRef(t *testing.T) map[alert.Ref]alert.Stored {
	t.Helper()
	stored, err := Alerts{}.Pending(context.Background())
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	byRef := map[alert.Ref]alert.Stored{}
	for _, s := range stored {
		if _, dup := byRef[s.Ref]; dup {
			t.Fatalf("Pending returned %v twice", s.Ref)
		}
		byRef[s.Ref] = s
	}
	return byRef
}

// seedAlerts stores one alert of each kind pending, and one of each kind
// sent or never raised, which Pending must leave out.
func seedAlerts(t *testing.T) {
	t.Helper()
	pending := alert.Raise(alert.Alert{}, discoveredT0)
	sent := alert.Alert{State: alert.Sent, Attempts: 1, SentAt: discoveredT0}

	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	setEventAlert(t, sandboxScope, "attribution_unresolved", pending)
	liveScope := webhookevent.Scope{AccountID: "acct_live", Livemode: true, EventID: "evt_1"}
	receiveEvent(t, "dlv_2", liveScope, receiptT0.Add(time.Second))
	setEventAlert(t, liveScope, "unsupported_api_version", sent)
	receiveEvent(t, "dlv_3", eventScope("evt_quiet"), receiptT0.Add(2*time.Second))

	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
	asked := discoveredT0.Add(time.Hour)
	b := openConflict("sub_b", discoveredT0)
	b.Version, b.SupportMessage, b.SupportAt = 3, "I was charged twice.", asked
	seedSubscription(t, b)
	setConflictAlert(t, "sub_b", pending)
	setSupportAlert(t, "sub_b", alert.Alert{State: alert.Pending, Attempts: 2, LastError: "resend: 500",
		NextAttemptAt: asked.Add(time.Hour), ClaimToken: "tok_old", ClaimExpiresAt: asked.Add(2 * time.Minute)})
	c := openConflict("sub_c", discoveredT0.Add(time.Minute))
	c.SupportMessage, c.SupportAt = "Please help.", asked
	seedSubscription(t, c)
	setConflictAlert(t, "sub_c", sent)
	setSupportAlert(t, "sub_c", sent)
}

var (
	eventAlertRef    = alert.Ref{Kind: alert.EventAttentionAlert, ID: "evt_1", AccountID: "acct_sandbox", Livemode: false}
	conflictAlertRef = alert.Ref{Kind: alert.ConflictAlert, ID: "sub_b"}
	supportAlertRef  = alert.Ref{Kind: alert.SupportAlert, ID: "sub_b"}
)

func TestAlertsPendingReadsEveryPendingAlertWithWhatItsMailIsComposedFrom(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedAlerts(t)

	got := pendingByRef(t)

	asked := discoveredT0.Add(time.Hour)
	want := map[alert.Ref]alert.Stored{
		eventAlertRef: {
			Ref:   eventAlertRef,
			Alert: alert.Raise(alert.Alert{}, discoveredT0),
			Content: alert.EventAttention{
				AccountID: "acct_sandbox", EventID: "evt_1", EventType: "invoice.paid", Reason: "attribution_unresolved",
				SubscriptionID: "sub_1", CustomerID: "cus_1", InvoiceID: "in_1", PaymentIntentID: "pi_1",
			},
		},
		conflictAlertRef: {
			Ref:   conflictAlertRef,
			Alert: alert.Raise(alert.Alert{}, discoveredT0),
			Content: alert.ConflictFound{
				SubscriptionID: "sub_b", AcceptedSubscriptionID: "sub_a", OwnerID: "user_1", CustomerID: "cus_sub_b",
				Reason: "second_live_subscription", DiscoveredAt: discoveredT0,
			},
		},
		supportAlertRef: {
			Ref: supportAlertRef,
			Alert: alert.Alert{State: alert.Pending, Attempts: 2, LastError: "resend: 500",
				NextAttemptAt: asked.Add(time.Hour), ClaimToken: "tok_old", ClaimExpiresAt: asked.Add(2 * time.Minute)},
			Content: alert.SupportRequested{SubscriptionID: "sub_b", OwnerID: "user_1", RequestedAt: asked},
		},
	}
	if len(got) != len(want) {
		t.Fatalf("Pending = %d alerts %v, want only the 3 pending ones", len(got), got)
	}
	for ref, w := range want {
		g, ok := got[ref]
		if !ok {
			t.Errorf("Pending has no %v", ref)
			continue
		}
		if !alertEqual(g.Alert, w.Alert) {
			t.Errorf("%v alert = %+v, want %+v", ref, g.Alert, w.Alert)
		}
		if !reflect.DeepEqual(g.Content.Mail(), w.Content.Mail()) {
			t.Errorf("%v mail = %+v, want %+v", ref, g.Content.Mail(), w.Content.Mail())
		}
	}
}

func TestAlertsSaveWritesTheAlertOnlyWhileTheStateReadStillHolds(t *testing.T) {
	ctx := context.Background()
	for _, ref := range []alert.Ref{eventAlertRef, conflictAlertRef, supportAlertRef} {
		t.Run(string(ref.Kind), func(t *testing.T) {
			newSubscriptionConflictDB(t)
			seedAlerts(t)
			store := Alerts{}
			read := pendingByRef(t)[ref].Alert
			now := discoveredT0.Add(3 * time.Hour)

			claimed, err := alert.Claim(read, "tok_a", now, 2*time.Minute, alert.StartupPass)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Save(ctx, ref, read, claimed); err != nil {
				t.Fatalf("Save claim: %v", err)
			}
			if got := pendingByRef(t)[ref].Alert; !alertEqual(got, claimed) {
				t.Fatalf("alert after the claim = %+v, want %+v", got, claimed)
			}

			// A notifier that read the alert before the claim must not take it.
			stolen, _ := alert.Claim(read, "tok_b", now, 2*time.Minute, alert.StartupPass)
			if err := store.Save(ctx, ref, read, stolen); !errors.Is(err, alert.ErrStaleClaim) {
				t.Fatalf("Save over a stale read = %v, want ErrStaleClaim", err)
			}

			sent, _ := alert.MarkSent(claimed, "tok_a", now.Add(time.Second))
			if err := store.Save(ctx, ref, claimed, sent); err != nil {
				t.Fatalf("Save sent: %v", err)
			}
			if _, ok := pendingByRef(t)[ref]; ok {
				t.Fatalf("%v is still pending after it was sent", ref)
			}
			// The claim token is cleared by the send, so the claim alone cannot
			// fence a notifier that read the alert before it was sent.
			if err := store.Save(ctx, ref, claimed, sent); !errors.Is(err, alert.ErrStaleClaim) {
				t.Fatalf("Save over the sent alert = %v, want ErrStaleClaim", err)
			}
			if err := store.Save(ctx, ref, read, stolen); !errors.Is(err, alert.ErrStaleClaim) {
				t.Fatalf("claim from a read taken before the send = %v, want ErrStaleClaim", err)
			}
			if _, ok := pendingByRef(t)[ref]; ok {
				t.Fatalf("%v was claimed again after it was sent", ref)
			}
		})
	}
}

func TestAlertsSaveLeavesTheRowsOtherAlertsAloneAndMovesTheSubscriptionVersionOn(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedAlerts(t)
	ctx := context.Background()
	store := Alerts{}
	before := pendingByRef(t)
	now := discoveredT0.Add(3 * time.Hour)

	read := before[conflictAlertRef].Alert
	claimed, _ := alert.Claim(read, "tok_a", now, 2*time.Minute, alert.StartupPass)
	if err := store.Save(ctx, conflictAlertRef, read, claimed); err != nil {
		t.Fatal(err)
	}

	after := pendingByRef(t)
	if !alertEqual(after[supportAlertRef].Alert, before[supportAlertRef].Alert) {
		t.Errorf("support alert = %+v after the conflict alert's save, want unchanged %+v",
			after[supportAlertRef].Alert, before[supportAlertRef].Alert)
	}
	if !alertEqual(after[eventAlertRef].Alert, before[eventAlertRef].Alert) {
		t.Errorf("event alert = %+v after the conflict alert's save, want unchanged", after[eventAlertRef].Alert)
	}
	if v := subscriptionVersion(t, "sub_b"); v != 4 {
		t.Errorf("sub_b version = %d after the alert save, want 4: every write to the row moves it on", v)
	}
}

func TestAlertsSaveOfAnAlertWithNoRowIsAnErrorNotAStaleClaim(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedAlerts(t)
	read := alert.Raise(alert.Alert{}, discoveredT0)
	claimed, _ := alert.Claim(read, "tok_a", discoveredT0, 2*time.Minute, alert.StartupPass)

	for _, ref := range []alert.Ref{
		{Kind: alert.EventAttentionAlert, ID: "evt_1", AccountID: "acct_other"},
		{Kind: alert.ConflictAlert, ID: "sub_missing"},
		{Kind: alert.SupportAlert, ID: "sub_missing"},
		{Kind: "unknown", ID: "sub_b"},
	} {
		err := Alerts{}.Save(context.Background(), ref, read, claimed)
		if err == nil || errors.Is(err, alert.ErrStaleClaim) {
			t.Errorf("Save(%v) = %v, want an error that is not ErrStaleClaim", ref, err)
		}
	}
}

type countingMailer struct{ sent atomic.Int64 }

func (m *countingMailer) SendAdminAlert(context.Context, string, string) error {
	m.sent.Add(1)
	return nil
}

func TestAlertsNotifierSendsEachPendingAlertOnceAcrossPasses(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedAlerts(t)
	mailer := &countingMailer{}
	var n atomic.Int64
	now := discoveredT0.Add(3 * time.Hour)
	notifier := alert.NewNotifier(Alerts{}, mailer,
		alert.NotifierSettings{Timeout: 30 * time.Second, Lease: 2 * time.Minute, RetryAfter: time.Hour},
		func() time.Time { return now }, func() string { return "tok_" + string(rune('a'+n.Add(1))) })

	report, err := notifier.Pass(context.Background(), alert.StartupPass)
	if err != nil {
		t.Fatal(err)
	}
	if report != (alert.Report{Sent: 3}) || mailer.sent.Load() != 3 {
		t.Fatalf("startup pass = %+v with %d mails, want the 3 pending alerts sent", report, mailer.sent.Load())
	}
	report, err = notifier.Pass(context.Background(), alert.StartupPass)
	if err != nil {
		t.Fatal(err)
	}
	if report != (alert.Report{}) || mailer.sent.Load() != 3 {
		t.Errorf("second pass = %+v with %d mails, want nothing sent again", report, mailer.sent.Load())
	}
	if len(pendingByRef(t)) != 0 {
		t.Errorf("alerts still pending after they were sent: %v", pendingByRef(t))
	}
}
