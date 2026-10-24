package repo

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func receiveEvent(t *testing.T, deliveryID string, scope webhookevent.Scope, at time.Time) {
	t.Helper()
	d := paidInvoiceDelivery(deliveryID, scope, at)
	if err := (WebhookReceipts{}).Record(context.Background(), d, webhookevent.NewTask("invoice.paid", "sub_1", at)); err != nil {
		t.Fatalf("Record %s: %v", deliveryID, err)
	}
}

func eventScope(id string) webhookevent.Scope {
	return webhookevent.Scope{AccountID: "acct_sandbox", Livemode: false, EventID: id}
}

func unfinished(t *testing.T, store WebhookEvents) map[string]webhookevent.StoredTask {
	t.Helper()
	tasks, err := store.Unfinished(context.Background())
	if err != nil {
		t.Fatalf("Unfinished: %v", err)
	}
	byID := map[string]webhookevent.StoredTask{}
	for _, s := range tasks {
		byID[s.Scope.EventID] = s
	}
	return byID
}

func TestWebhookEventsUnfinishedReadsEveryPendingProcessingAndWaitingTaskAsReceived(t *testing.T) {
	newWebhookReceiptDB(t)
	for i, status := range []string{"pending", "processing", "waiting_dependency", "processed", "needs_attention", "ignored"} {
		id := "evt_" + status
		receiveEvent(t, "dlv_"+status, eventScope(id), receiptT0.Add(time.Duration(i)*time.Second))
		if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET status = ? WHERE event_id = ?", status, id).Error; err != nil {
			t.Fatal(err)
		}
	}

	got := unfinished(t, NewWebhookEvents(nil))

	if len(got) != 3 {
		t.Fatalf("Unfinished = %d tasks %v, want the pending, processing and waiting ones", len(got), got)
	}
	for _, id := range []string{"evt_pending", "evt_processing", "evt_waiting_dependency"} {
		if _, ok := got[id]; !ok {
			t.Errorf("Unfinished has no %s", id)
		}
	}
	want := webhookevent.StoredTask{
		Scope:      eventScope("evt_pending"),
		APIVersion: "2026-07-29.dahlia",
		Task:       webhookevent.NewTask("invoice.paid", "sub_1", receiptT0),
	}
	if s := got["evt_pending"]; !storedTaskEqual(s, want) {
		t.Errorf("pending task = %+v, want %+v", s, want)
	}
}

func TestWebhookEventsSaveWritesEachTransitionWhileTheClaimIsHeld(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(nil)
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	read := unfinished(t, store)["evt_1"]

	now := receiptT0.Add(time.Minute)
	claimed, err := webhookevent.ClaimTask(read.Task, "tok_a", now, 2*time.Minute, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, sandboxScope, read.Task, claimed, nil); err != nil {
		t.Fatalf("Save claim: %v", err)
	}
	afterClaim := unfinished(t, store)["evt_1"]
	wantClaimed := webhookevent.StoredTask{Scope: sandboxScope, APIVersion: "2026-07-29.dahlia", Task: claimed}
	if !storedTaskEqual(afterClaim, wantClaimed) {
		t.Fatalf("task after the claim = %+v, want %+v", afterClaim, wantClaimed)
	}

	done, err := webhookevent.Complete(claimed, "tok_a", now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, sandboxScope, claimed, done, nil); err != nil {
		t.Fatalf("Save completion: %v", err)
	}
	if _, ok := unfinished(t, store)["evt_1"]; ok {
		t.Fatal("a processed task is still unfinished")
	}
	e := storedEvents(t)[0]
	if e.Status != "processed" || e.Attempts != 1 || e.ClaimToken != "" || e.CompletedAt == nil || *e.CompletedAt != now.Add(time.Second).UnixMilli() {
		t.Errorf("stored event = %+v, want processed after one attempt, claim dropped, completed at %d", e, now.Add(time.Second).UnixMilli())
	}
}

func TestWebhookEventsSaveRefusesAWorkerWhoseClaimWasTakenOver(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(nil)
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	read := unfinished(t, store)["evt_1"].Task

	// Worker A claims, its lease lapses, and worker B takes the task over.
	now := receiptT0.Add(time.Minute)
	claimedA, _ := webhookevent.ClaimTask(read, "tok_a", now, 2*time.Minute, true)
	if err := store.Save(ctx, sandboxScope, read, claimedA, nil); err != nil {
		t.Fatal(err)
	}
	later := now.Add(3 * time.Minute)
	claimedB, err := webhookevent.ClaimTask(claimedA, "tok_b", later, 2*time.Minute, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, sandboxScope, claimedA, claimedB, nil); err != nil {
		t.Fatalf("takeover: %v", err)
	}

	doneA, _ := webhookevent.Complete(claimedA, "tok_a", later)
	err = store.Save(ctx, sandboxScope, claimedA, doneA, nil)

	if !errors.Is(err, webhookevent.ErrStaleClaim) {
		t.Fatalf("stale Save = %v, want ErrStaleClaim", err)
	}
	got := unfinished(t, store)["evt_1"]
	if got.Task.Status != webhookevent.Processing || got.Task.ClaimToken != "tok_b" {
		t.Errorf("task after the stale Save = %+v, want B's claim kept", got.Task)
	}
}

func TestWebhookEventsSaveOfAnUnknownEventIsAnError(t *testing.T) {
	newWebhookReceiptDB(t)
	read := webhookevent.NewTask("invoice.paid", "sub_1", receiptT0)
	claimed, _ := webhookevent.ClaimTask(read, "tok_a", receiptT0, 2*time.Minute, true)

	err := NewWebhookEvents(nil).Save(context.Background(), eventScope("evt_missing"), read, claimed, nil)

	if err == nil || errors.Is(err, webhookevent.ErrStaleClaim) {
		t.Fatalf("Save of an event that was never received = %v, want an error the worker reports rather than skips as a lost claim", err)
	}
}

func TestWebhookEventsTwoWorkersClaimingTheSameTaskOnlyOneWins(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(nil)
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	read := unfinished(t, store)["evt_1"].Task

	now := receiptT0.Add(time.Minute)
	claimedA, _ := webhookevent.ClaimTask(read, "tok_a", now, 2*time.Minute, true)
	claimedB, _ := webhookevent.ClaimTask(read, "tok_b", now, 2*time.Minute, true)
	errA := store.Save(ctx, sandboxScope, read, claimedA, nil)
	errB := store.Save(ctx, sandboxScope, read, claimedB, nil)

	if errA != nil || !errors.Is(errB, webhookevent.ErrStaleClaim) {
		t.Fatalf("claims = %v, %v; want A to win and B to get ErrStaleClaim", errA, errB)
	}
	if got := unfinished(t, store)["evt_1"].Task.ClaimToken; got != "tok_a" {
		t.Errorf("claim token = %q, want tok_a", got)
	}
}

// grantEffect stands for a handler's local changes: the applier writes it
// to a scratch table inside the task's transaction.
type grantEffect struct{ invoice string }

func newGrantApplier(t *testing.T, fail error) EffectApplier {
	t.Helper()
	if err := sqlitex.DB.Exec("CREATE TABLE test_grants (invoice text NOT NULL)").Error; err != nil {
		t.Fatal(err)
	}
	return func(tx *gorm.DB, _ webhookevent.Scope, effects webhookevent.Effects) error {
		g, ok := effects.(grantEffect)
		if !ok {
			return errors.New("unexpected effects")
		}
		if err := tx.Exec("INSERT INTO test_grants (invoice) VALUES (?)", g.invoice).Error; err != nil {
			return err
		}
		return fail
	}
}

func testGrants(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM test_grants").Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// claimedTask receives evt_1 and has worker tok_a claim it.
func claimedTask(t *testing.T, store WebhookEvents) webhookevent.Task {
	t.Helper()
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
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

func TestWebhookEventsSaveCommitsTheEffectsWithTheOutcome(t *testing.T) {
	newWebhookReceiptDB(t)
	store := NewWebhookEvents(newGrantApplier(t, nil))
	claimed := claimedTask(t, store)
	done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(2*time.Minute))

	if err := store.Save(context.Background(), sandboxScope, claimed, done, grantEffect{invoice: "in_1"}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if n := testGrants(t); n != 1 {
		t.Errorf("%d grants, want 1", n)
	}
	if e := storedEvents(t)[0]; e.Status != "processed" {
		t.Errorf("status = %s, want processed", e.Status)
	}
}

func TestWebhookEventsAFailedEffectLeavesTheTaskAsItWas(t *testing.T) {
	newWebhookReceiptDB(t)
	store := NewWebhookEvents(newGrantApplier(t, errors.New("revalidation failed")))
	claimed := claimedTask(t, store)
	done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(2*time.Minute))

	err := store.Save(context.Background(), sandboxScope, claimed, done, grantEffect{invoice: "in_1"})

	if err == nil || errors.Is(err, webhookevent.ErrStaleClaim) {
		t.Fatalf("Save = %v, want the effect's error", err)
	}
	if n := testGrants(t); n != 0 {
		t.Errorf("%d grants kept after the failed Save, want none", n)
	}
	if got := unfinished(t, store)["evt_1"].Task; got.Status != webhookevent.Processing || got.ClaimToken != "tok_a" {
		t.Errorf("task = %+v, want still claimed by tok_a", got)
	}
}

func TestWebhookEventsAStaleClaimCommitsNoEffect(t *testing.T) {
	newWebhookReceiptDB(t)
	store := NewWebhookEvents(newGrantApplier(t, nil))
	claimed := claimedTask(t, store)
	takeover, _ := webhookevent.ClaimTask(claimed, "tok_b", receiptT0.Add(4*time.Minute), 2*time.Minute, true)
	if err := store.Save(context.Background(), sandboxScope, claimed, takeover, nil); err != nil {
		t.Fatal(err)
	}
	done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(4*time.Minute))

	err := store.Save(context.Background(), sandboxScope, claimed, done, grantEffect{invoice: "in_1"})

	if !errors.Is(err, webhookevent.ErrStaleClaim) {
		t.Fatalf("Save = %v, want ErrStaleClaim", err)
	}
	if n := testGrants(t); n != 0 {
		t.Errorf("%d grants committed by a stale worker, want none", n)
	}
}

func TestWebhookEventsSaveRefusesEffectsItCannotApply(t *testing.T) {
	newWebhookReceiptDB(t)
	store := NewWebhookEvents(nil)
	claimed := claimedTask(t, store)
	done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(2*time.Minute))

	err := store.Save(context.Background(), sandboxScope, claimed, done, grantEffect{invoice: "in_1"})

	if err == nil {
		t.Fatal("Save dropped effects it has no applier for")
	}
	if got := unfinished(t, store)["evt_1"].Task; got.Status != webhookevent.Processing {
		t.Errorf("task = %+v, want still processing: an outcome never commits without its effects", got)
	}
}

type storedAlert struct {
	AlertState         string
	AlertAttempts      int
	AlertNextAttemptAt *int64
	AlertSentAt        *int64
}

func readAlert(t *testing.T) storedAlert {
	t.Helper()
	var a storedAlert
	if err := sqlitex.DB.Raw("SELECT alert_state, alert_attempts, alert_next_attempt_at, alert_sent_at FROM stripe_webhook_events").Scan(&a).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

func TestWebhookEventsAnEscalationRaisesTheAlertInTheSameWrite(t *testing.T) {
	newWebhookReceiptDB(t)
	store := NewWebhookEvents(nil)
	claimed := claimedTask(t, store)
	at := receiptT0.Add(2 * time.Minute)
	escalated, _ := webhookevent.Escalate(claimed, "tok_a", at, "unsupported_api_version")

	if err := store.Save(context.Background(), sandboxScope, claimed, escalated, nil); err != nil {
		t.Fatalf("Save: %v", err)
	}

	a := readAlert(t)
	if a.AlertState != "pending" || a.AlertNextAttemptAt == nil || *a.AlertNextAttemptAt != at.UnixMilli() {
		t.Errorf("alert = %+v, want pending and due at %d", a, at.UnixMilli())
	}
	if e := storedEvents(t)[0]; e.Status != "needs_attention" {
		t.Errorf("status = %s, want needs_attention", e.Status)
	}
}

func TestWebhookEventsATaskSaveNeverUndoesTheNotifiersSend(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(nil)
	claimed := claimedTask(t, store)
	at := receiptT0.Add(2 * time.Minute)
	escalated, _ := webhookevent.Escalate(claimed, "tok_a", at, "unsupported_api_version")
	if err := store.Save(ctx, sandboxScope, claimed, escalated, nil); err != nil {
		t.Fatal(err)
	}
	// The notifier sends the alert after the administrator read the task.
	sentAt := at.Add(time.Minute)
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET alert_state = 'sent', alert_attempts = 1, alert_next_attempt_at = NULL, alert_sent_at = ?",
		sentAt.UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}

	retried, err := webhookevent.RetryByOperator(escalated, at.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, sandboxScope, escalated, retried, nil); err != nil {
		t.Fatalf("Save retry: %v", err)
	}

	a := readAlert(t)
	if a.AlertState != "sent" || a.AlertAttempts != 1 || a.AlertSentAt == nil || *a.AlertSentAt != sentAt.UnixMilli() {
		t.Errorf("alert after the retry = %+v, want the notifier's send kept", a)
	}
	if got := unfinished(t, store)["evt_1"].Task; got.Status != webhookevent.Pending || got.Alert.State != alert.Sent {
		t.Errorf("task = %+v, want pending again with its sent alert", got)
	}
}

func TestWebhookEventsReadTheLegacyBackfillMarkerOnceItIsMarked(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(nil)

	before, err := store.LegacyBackfillDone(ctx)
	if err != nil || before {
		t.Fatalf("LegacyBackfillDone before marking = %t, %v; want false", before, err)
	}
	for i := range 2 {
		if err := MarkLegacyBackfillDone(ctx); err != nil {
			t.Fatalf("MarkLegacyBackfillDone #%d: %v", i+1, err)
		}
	}
	after, err := store.LegacyBackfillDone(ctx)
	if err != nil || !after {
		t.Fatalf("LegacyBackfillDone after marking = %t, %v; want true", after, err)
	}
}

// grantHandler handles every event by granting its invoice once.
type grantHandler struct {
	mu    sync.Mutex
	calls int
}

func (h *grantHandler) Handle(_ context.Context, _ webhookevent.Kind, s webhookevent.StoredTask) webhookevent.Result {
	h.mu.Lock()
	h.calls++
	h.mu.Unlock()
	return webhookevent.Result{Step: webhookevent.Handled, Effects: grantEffect{invoice: s.Scope.EventID}}
}

func newTestWorker(store WebhookEvents, h webhookevent.Handler, now time.Time) *webhookevent.Worker {
	var tokens atomic.Int64
	return webhookevent.NewWorker(store, h, webhookevent.WorkerSettings{
		Timeout: 30 * time.Second, Lease: 2 * time.Minute, BackoffMin: 5 * time.Second, BackoffMax: 15 * time.Minute,
		DependencyWaitDeadline: 24 * time.Hour,
	}, func() time.Time { return now }, func() string { return fmt.Sprintf("tok_%d_%p", tokens.Add(1), h) })
}

func TestWebhookEventsWorkerHoldsSubscriptionInvoicesUntilTheBackfillThenGrantsOnce(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(newGrantApplier(t, nil))
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	h := &grantHandler{}
	worker := newTestWorker(store, h, receiptT0.Add(time.Minute))

	if _, err := worker.Pass(ctx); err != nil {
		t.Fatalf("Pass before the backfill: %v", err)
	}
	if h.calls != 0 || storedEvents(t)[0].Status != "pending" {
		t.Fatalf("before the backfill: %d handler calls, status %s; want the invoice held pending", h.calls, storedEvents(t)[0].Status)
	}

	if err := MarkLegacyBackfillDone(ctx); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := worker.Pass(ctx); err != nil {
			t.Fatalf("Pass: %v", err)
		}
	}

	if h.calls != 1 || testGrants(t) != 1 || storedEvents(t)[0].Status != "processed" {
		t.Errorf("after the backfill: %d handler calls, %d grants, status %s; want one of each, processed",
			h.calls, testGrants(t), storedEvents(t)[0].Status)
	}
}

func TestWebhookEventsTwoWorkersSharingTheStoreApplyAnEventOnce(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(newGrantApplier(t, nil))
	if err := MarkLegacyBackfillDone(ctx); err != nil {
		t.Fatal(err)
	}
	for i := range 5 {
		receiveEvent(t, fmt.Sprintf("dlv_%d", i), eventScope(fmt.Sprintf("evt_%d", i)), receiptT0.Add(time.Duration(i)*time.Second))
	}
	now := receiptT0.Add(time.Minute)

	var wg sync.WaitGroup
	for range 2 {
		worker := newTestWorker(store, &grantHandler{}, now)
		wg.Go(func() {
			if _, err := worker.Pass(ctx); err != nil {
				t.Errorf("Pass: %v", err)
			}
		})
	}
	wg.Wait()

	if n := testGrants(t); n != 5 {
		t.Errorf("%d grants for 5 events, want 5", n)
	}
	var grants []string
	if err := sqlitex.DB.Raw("SELECT invoice FROM test_grants GROUP BY invoice HAVING count(*) > 1").Scan(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if len(grants) != 0 {
		t.Errorf("granted twice: %v", grants)
	}
}

// storedTaskEqual compares instants, not time.Time representations.
func storedTaskEqual(a, b webhookevent.StoredTask) bool {
	norm := func(s webhookevent.StoredTask) webhookevent.StoredTask {
		for _, p := range []*time.Time{
			&s.Task.FirstWaitAt, &s.Task.NextAttemptAt, &s.Task.CompletedAt, &s.Task.ClaimExpiresAt,
			&s.Task.Alert.NextAttemptAt, &s.Task.Alert.SentAt, &s.Task.Alert.ClaimExpiresAt,
		} {
			if !p.IsZero() {
				*p = p.UTC()
			}
		}
		return s
	}
	return norm(a) == norm(b)
}
