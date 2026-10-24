package repo

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newWebhookReceiptDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "enx.db")), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if _, err := sqlitex.MigrateWebhookReceipts(db); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

var receiptT0 = time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)

var sandboxScope = webhookevent.Scope{AccountID: "acct_sandbox", Livemode: false, EventID: "evt_1"}

func paidInvoiceDelivery(id string, scope webhookevent.Scope, receivedAt time.Time) webhookevent.Delivery {
	return webhookevent.Delivery{
		ID:         id,
		ReceivedAt: receivedAt,
		Receipt: webhookevent.Receipt{
			Envelope: webhookevent.Envelope{
				EventID: scope.EventID, Type: "invoice.paid", Created: 1792843200,
				APIVersion: "2026-07-29.dahlia", Livemode: scope.Livemode,
			},
			Scope: scope,
			Refs: webhookevent.References{
				SubscriptionID: "sub_1", CustomerID: "cus_1", InvoiceID: "in_1", PaymentIntentID: "pi_1",
			},
		},
		Payload: []byte(`{"id":"` + scope.EventID + `","object":"event","type":"invoice.paid","receipt":"` + id + `"}`),
	}
}

type storedDelivery struct {
	Id              string
	ReceivedAt      int64
	StripeAccountId string
	Livemode        bool
	EventId         string
	EventType       string
	EventCreated    int64
	ApiVersion      string
	Payload         []byte
}

func storedDeliveries(t *testing.T) []storedDelivery {
	t.Helper()
	var rows []storedDelivery
	if err := sqlitex.DB.Raw(`SELECT id, received_at, stripe_account_id, livemode, event_id, event_type,
		event_created, api_version, payload FROM stripe_webhook_deliveries ORDER BY received_at, id`).Scan(&rows).Error; err != nil {
		t.Fatalf("read deliveries: %v", err)
	}
	return rows
}

type storedEvent struct {
	StripeAccountId   string
	Livemode          bool
	EventId           string
	Type              string
	Created           int64
	ApiVersion        string
	FirstDeliveryId   string
	FirstReceivedAt   int64
	SubscriptionId    string
	CustomerId        string
	CheckoutSessionId string
	InvoiceId         string
	PaymentIntentId   string
	ChargeId          string
	Status            string
	Attempts          int
	NextAttemptAt     *int64
	FirstWaitAt       *int64
	CompletedAt       *int64
	ClaimToken        string
	AlertState        string
}

func storedEvents(t *testing.T) []storedEvent {
	t.Helper()
	var rows []storedEvent
	if err := sqlitex.DB.Raw(`SELECT stripe_account_id, livemode, event_id, type, created, api_version,
		first_delivery_id, first_received_at, subscription_id, customer_id, checkout_session_id, invoice_id,
		payment_intent_id, charge_id, status, attempts, next_attempt_at, first_wait_at, completed_at,
		claim_token, alert_state
		FROM stripe_webhook_events ORDER BY livemode, event_id`).Scan(&rows).Error; err != nil {
		t.Fatalf("read events: %v", err)
	}
	return rows
}

func TestWebhookReceiptsRecordStoresTheDeliveryWithItsPayloadAndTheEventTask(t *testing.T) {
	newWebhookReceiptDB(t)
	d := paidInvoiceDelivery("dlv_1", sandboxScope, receiptT0)

	if err := (WebhookReceipts{}).Record(context.Background(), d, webhookevent.NewTask("invoice.paid", "sub_1", receiptT0)); err != nil {
		t.Fatalf("Record: %v", err)
	}

	deliveries := storedDeliveries(t)
	if len(deliveries) != 1 {
		t.Fatalf("%d deliveries, want 1", len(deliveries))
	}
	got := deliveries[0]
	want := storedDelivery{
		Id: "dlv_1", ReceivedAt: receiptT0.UnixMilli(), StripeAccountId: "acct_sandbox", Livemode: false,
		EventId: "evt_1", EventType: "invoice.paid", EventCreated: 1792843200, ApiVersion: "2026-07-29.dahlia",
	}
	if !bytes.Equal(got.Payload, d.Payload) {
		t.Errorf("payload = %s, want the original %s", got.Payload, d.Payload)
	}
	got.Payload = nil
	if !reflect.DeepEqual(got, want) {
		t.Errorf("delivery = %+v, want %+v", got, want)
	}

	events := storedEvents(t)
	if len(events) != 1 {
		t.Fatalf("%d events, want 1", len(events))
	}
	e := events[0]
	due := receiptT0.UnixMilli()
	wantEvent := storedEvent{
		StripeAccountId: "acct_sandbox", Livemode: false, EventId: "evt_1", Type: "invoice.paid",
		Created: 1792843200, ApiVersion: "2026-07-29.dahlia", FirstDeliveryId: "dlv_1", FirstReceivedAt: receiptT0.UnixMilli(),
		SubscriptionId: "sub_1", CustomerId: "cus_1", InvoiceId: "in_1", PaymentIntentId: "pi_1",
		Status: "pending",
	}
	if e.NextAttemptAt == nil || *e.NextAttemptAt != due {
		t.Errorf("next_attempt_at = %v, want %d (due at receipt)", e.NextAttemptAt, due)
	}
	if e.FirstWaitAt != nil || e.CompletedAt != nil {
		t.Errorf("first_wait_at = %v, completed_at = %v, want both NULL on a new task", e.FirstWaitAt, e.CompletedAt)
	}
	e.NextAttemptAt = nil
	if e != wantEvent {
		t.Errorf("event = %+v, want %+v", e, wantEvent)
	}
}

func TestWebhookReceiptsKeepEveryRepeatedDeliveryAndNeverResetTheTask(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := WebhookReceipts{}
	if err := store.Record(ctx, paidInvoiceDelivery("dlv_1", sandboxScope, receiptT0), webhookevent.NewTask("invoice.paid", "sub_1", receiptT0)); err != nil {
		t.Fatalf("first Record: %v", err)
	}
	// The worker has since finished the event.
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET status = 'processed', attempts = 1, completed_at = ?",
		receiptT0.Add(time.Minute).UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}

	later := receiptT0.Add(time.Hour)
	if err := store.Record(ctx, paidInvoiceDelivery("dlv_2", sandboxScope, later), webhookevent.NewTask("invoice.paid", "sub_1", later)); err != nil {
		t.Fatalf("repeated Record: %v", err)
	}

	deliveries := storedDeliveries(t)
	if len(deliveries) != 2 || deliveries[0].Id != "dlv_1" || deliveries[1].Id != "dlv_2" {
		t.Fatalf("deliveries = %+v, want dlv_1 and dlv_2 both kept", deliveries)
	}
	if !bytes.Contains(deliveries[1].Payload, []byte(`"receipt":"dlv_2"`)) {
		t.Errorf("second delivery payload = %s, want its own original payload", deliveries[1].Payload)
	}
	events := storedEvents(t)
	if len(events) != 1 {
		t.Fatalf("%d events, want the one event of both deliveries", len(events))
	}
	e := events[0]
	if e.Status != "processed" || e.Attempts != 1 || e.CompletedAt == nil || e.FirstDeliveryId != "dlv_1" || e.FirstReceivedAt != receiptT0.UnixMilli() {
		t.Errorf("event after redelivery = %+v, want the finished task of dlv_1 unchanged", e)
	}
}

func TestWebhookReceiptsScopeEventIDsByAccountAndMode(t *testing.T) {
	newWebhookReceiptDB(t)
	ctx := context.Background()
	store := WebhookReceipts{}
	live := webhookevent.Scope{AccountID: "acct_sandbox", Livemode: true, EventID: "evt_1"}
	other := webhookevent.Scope{AccountID: "acct_other", Livemode: false, EventID: "evt_1"}

	for i, scope := range []webhookevent.Scope{sandboxScope, live, other} {
		d := paidInvoiceDelivery(fmt.Sprintf("dlv_%d", i), scope, receiptT0.Add(time.Duration(i)*time.Second))
		if err := store.Record(ctx, d, webhookevent.NewTask("invoice.paid", "sub_1", receiptT0)); err != nil {
			t.Fatalf("Record %+v: %v", scope, err)
		}
	}

	if n := len(storedEvents(t)); n != 3 {
		t.Fatalf("%d events, want 3: one Event ID in three account/mode scopes is three events", n)
	}
}

func TestWebhookReceiptsStoreNoDeliveryWhenTheTaskCannotBeStored(t *testing.T) {
	newWebhookReceiptDB(t)
	if err := sqlitex.DB.Exec("DROP TABLE stripe_webhook_events").Error; err != nil {
		t.Fatal(err)
	}

	err := (WebhookReceipts{}).Record(context.Background(), paidInvoiceDelivery("dlv_1", sandboxScope, receiptT0), webhookevent.NewTask("invoice.paid", "sub_1", receiptT0))

	if err == nil {
		t.Fatal("Record succeeded without an event table, want an error so receipt answers non-2xx")
	}
	if n := len(storedDeliveries(t)); n != 0 {
		t.Fatalf("%d deliveries kept after a failed Record, want none: the delivery and its task commit together", n)
	}
}
