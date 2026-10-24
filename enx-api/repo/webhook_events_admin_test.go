package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/eventadmin"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"
)

var sandboxEndpoint = webhookevent.Endpoint{AccountID: "acct_sandbox", Livemode: false}

func setEventStatus(t *testing.T, scope webhookevent.Scope, status webhookevent.Status) {
	t.Helper()
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET status = ? WHERE stripe_account_id = ? AND livemode = ? AND event_id = ?",
		string(status), scope.AccountID, scope.Livemode, scope.EventID).Error; err != nil {
		t.Fatal(err)
	}
}

func listedIDs(events []eventadmin.Event) []string {
	ids := make([]string, len(events))
	for i, e := range events {
		ids[i] = e.Scope.EventID
	}
	return ids
}

func TestWebhookEventsListEventsPagesTheEndpointsEventsInOneStatusNewestReceiptFirst(t *testing.T) {
	newWebhookReceiptDB(t)
	for i, id := range []string{"evt_a", "evt_b", "evt_c", "evt_d"} {
		scope := eventScope(id)
		receiveEvent(t, "dlv_"+id, scope, receiptT0.Add(time.Duration(i)*time.Minute))
		setEventStatus(t, scope, webhookevent.NeedsAttention)
	}
	receiveEvent(t, "dlv_processed", eventScope("evt_processed"), receiptT0.Add(10*time.Minute))
	setEventStatus(t, eventScope("evt_processed"), webhookevent.Processed)
	live := webhookevent.Scope{AccountID: "acct_sandbox", Livemode: true, EventID: "evt_live"}
	receiveEvent(t, "dlv_live", live, receiptT0.Add(11*time.Minute))
	setEventStatus(t, live, webhookevent.NeedsAttention)
	other := webhookevent.Scope{AccountID: "acct_other", Livemode: false, EventID: "evt_other"}
	receiveEvent(t, "dlv_other", other, receiptT0.Add(12*time.Minute))
	setEventStatus(t, other, webhookevent.NeedsAttention)

	got, err := NewWebhookEvents(nil).ListEvents(context.Background(), sandboxEndpoint,
		eventadmin.ListQuery{Status: webhookevent.NeedsAttention, Limit: 2, Offset: 1})

	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if ids := listedIDs(got); len(ids) != 2 || ids[0] != "evt_c" || ids[1] != "evt_b" {
		t.Fatalf("ListEvents = %v, want [evt_c evt_b]: the endpoint's needs_attention events, newest receipt first, from offset 1", ids)
	}
	want := eventadmin.Event{
		Scope:      eventScope("evt_c"),
		APIVersion: "2026-07-29.dahlia",
		Created:    time.Unix(1792843200, 0),
		Refs:       webhookevent.References{SubscriptionID: "sub_1", CustomerID: "cus_1", InvoiceID: "in_1", PaymentIntentID: "pi_1"},
		Task:       webhookevent.NewTask("invoice.paid", "sub_1", receiptT0.Add(2*time.Minute)),
	}
	want.Task.Status = webhookevent.NeedsAttention
	if !adminEventEqual(got[0], want) {
		t.Errorf("listed event = %+v, want %+v", got[0], want)
	}
}

func TestWebhookEventsEventReadsEveryDeliveryAndTheFirstDeliverysPayload(t *testing.T) {
	newWebhookReceiptDB(t)
	receiveEvent(t, "dlv_first", sandboxScope, receiptT0)
	receiveEvent(t, "dlv_again", sandboxScope, receiptT0.Add(time.Hour))
	receiveEvent(t, "dlv_other", eventScope("evt_other"), receiptT0.Add(time.Minute))

	got, err := NewWebhookEvents(nil).Event(context.Background(), sandboxScope)

	if err != nil {
		t.Fatalf("Event: %v", err)
	}
	if got.Event.Scope != sandboxScope || got.Event.Refs.InvoiceID != "in_1" || got.Event.Task.Type != "invoice.paid" {
		t.Errorf("event = %+v, want evt_1, the invoice.paid of in_1", got.Event)
	}
	if len(got.Deliveries) != 2 ||
		got.Deliveries[0].ID != "dlv_first" || !got.Deliveries[0].ReceivedAt.Equal(receiptT0) ||
		got.Deliveries[1].ID != "dlv_again" || !got.Deliveries[1].ReceivedAt.Equal(receiptT0.Add(time.Hour)) {
		t.Errorf("deliveries = %+v, want dlv_first at %s then dlv_again an hour later", got.Deliveries, receiptT0)
	}
	if want := `{"id":"evt_1","object":"event","type":"invoice.paid","receipt":"dlv_first"}`; string(got.Payload) != want {
		t.Errorf("payload = %s, want the first delivery's %s", got.Payload, want)
	}
}

func TestWebhookEventsEventOfAnUnknownOrOtherEndpointsEventIsNotFound(t *testing.T) {
	newWebhookReceiptDB(t)
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	store := NewWebhookEvents(nil)

	for name, scope := range map[string]webhookevent.Scope{
		"unknown ID":    eventScope("evt_missing"),
		"live mode":     {AccountID: "acct_sandbox", Livemode: true, EventID: "evt_1"},
		"other account": {AccountID: "acct_other", Livemode: false, EventID: "evt_1"},
	} {
		if _, err := store.Event(context.Background(), scope); !errors.Is(err, eventadmin.ErrNotFound) {
			t.Errorf("%s: Event = %v, want eventadmin.ErrNotFound", name, err)
		}
	}
}

func TestWebhookEventsAnOperatorRetryRequeuesTheEventAndKeepsItsSentAlert(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := NewWebhookEvents(nil)
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	read := unfinished(t, store)["evt_1"].Task
	now := receiptT0.Add(time.Minute)
	claimed, _ := webhookevent.ClaimTask(read, "tok_a", now, 2*time.Minute, true)
	if err := store.Save(ctx, sandboxScope, read, claimed, nil); err != nil {
		t.Fatal(err)
	}
	escalated, _ := webhookevent.Escalate(claimed, "tok_a", now, "unsupported_api_version")
	if err := store.Save(ctx, sandboxScope, claimed, escalated, nil); err != nil {
		t.Fatal(err)
	}
	sentAt := now.Add(time.Hour)
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET alert_state = 'sent', alert_attempts = 1, alert_sent_at = ? WHERE event_id = 'evt_1'",
		sentAt.UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}
	retryAt := now.Add(2 * time.Hour)
	svc := eventadmin.New(store, func() webhookevent.Endpoint { return sandboxEndpoint }, func() time.Time { return retryAt })

	if _, err := svc.Retry(ctx, "evt_1"); err != nil {
		t.Fatalf("Retry: %v", err)
	}

	d, err := svc.Detail(ctx, "evt_1")
	if err != nil {
		t.Fatalf("Detail: %v", err)
	}
	task := d.Event.Task
	if task.Status != webhookevent.Pending || !task.NextAttemptAt.Equal(retryAt) || task.LastError != "unsupported_api_version" {
		t.Errorf("task after the retry = %+v, want pending at %s with its reason kept", task, retryAt)
	}
	if task.Alert.State != "sent" || task.Alert.Attempts != 1 || !task.Alert.SentAt.Equal(sentAt) {
		t.Errorf("alert after the retry = %+v, want still sent at %s", task.Alert, sentAt)
	}
	if listed, _ := svc.List(ctx, "", 0, 0); len(listed) != 0 {
		t.Errorf("needs_attention list after the retry = %v, want empty", listedIDs(listed))
	}
	if _, err := svc.Retry(ctx, "evt_1"); !errors.Is(err, eventadmin.ErrNotRetryable) {
		t.Errorf("second Retry = %v, want ErrNotRetryable", err)
	}
}

// adminEventEqual compares instants, not time.Time representations.
func adminEventEqual(a, b eventadmin.Event) bool {
	if !a.Created.Equal(b.Created) {
		return false
	}
	a.Created, b.Created = time.Time{}, time.Time{}
	sa := webhookevent.StoredTask{Scope: a.Scope, APIVersion: a.APIVersion, Task: a.Task}
	sb := webhookevent.StoredTask{Scope: b.Scope, APIVersion: b.APIVersion, Task: b.Task}
	return a.Refs == b.Refs && storedTaskEqual(sa, sb)
}
