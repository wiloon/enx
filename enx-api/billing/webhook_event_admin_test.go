package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/eventadmin"
	"enx-api/billing/webhookevent"

	"github.com/gin-gonic/gin"
)

var (
	eventReceived = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	eventNow      = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	eventEndpoint = webhookevent.Endpoint{AccountID: "acct_1"}
)

// eventStore holds one event, evt_1, that needs attention after its alert
// was sent, delivered twice, and counts the retries saved on it.
type eventStore struct {
	detail    eventadmin.Detail
	query     eventadmin.ListQuery
	listCalls int
	saves     int
	err       error
}

func newEventStore() *eventStore {
	return &eventStore{detail: eventadmin.Detail{
		Event: eventadmin.Event{
			Scope:      eventEndpoint.Scope("evt_1"),
			APIVersion: "2026-08-26.dahlia",
			Created:    eventReceived.Add(-time.Minute),
			Refs:       webhookevent.References{SubscriptionID: "sub_1", CustomerID: "cus_1", InvoiceID: "in_1"},
			Task: webhookevent.Task{
				Type:           "invoice.paid",
				SubscriptionID: "sub_1",
				Status:         webhookevent.NeedsAttention,
				Attempts:       4,
				LastError:      "unattributed_invoice",
				FirstWaitAt:    eventReceived,
				NextAttemptAt:  eventReceived.Add(time.Hour),
				Alert:          alert.Alert{State: alert.Sent, Attempts: 1, SentAt: eventReceived.Add(25 * time.Hour)},
			},
		},
		Deliveries: []eventadmin.Delivery{{ID: "dlv_1", ReceivedAt: eventReceived}, {ID: "dlv_2", ReceivedAt: eventReceived.Add(time.Minute)}},
		Payload:    json.RawMessage(`{"id":"evt_1","object":"event","type":"invoice.paid"}`),
	}}
}

func (s *eventStore) ListEvents(_ context.Context, _ webhookevent.Endpoint, q eventadmin.ListQuery) ([]eventadmin.Event, error) {
	s.listCalls++
	s.query = q
	if s.err != nil {
		return nil, s.err
	}
	return []eventadmin.Event{s.detail.Event}, nil
}

func (s *eventStore) Event(_ context.Context, scope webhookevent.Scope) (eventadmin.Detail, error) {
	if s.err != nil {
		return eventadmin.Detail{}, s.err
	}
	if scope.EventID != "evt_1" {
		return eventadmin.Detail{}, eventadmin.ErrNotFound
	}
	return s.detail, nil
}

func (s *eventStore) Save(_ context.Context, _ webhookevent.Scope, _, next webhookevent.Task, _ webhookevent.Effects) error {
	s.saves++
	s.detail.Event.Task = next
	return nil
}

func serveEventAdmin(t *testing.T, store *eventStore, endpoint webhookevent.Endpoint, method, target string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	h := NewWebhookEventAdminHandler(eventadmin.New(store, func() webhookevent.Endpoint { return endpoint }, func() time.Time { return eventNow }))
	path := alert.AdminWebhookEventsPath
	router.GET(path, setUserID("admin_1"), h.List)
	router.GET(path+"/:id", setUserID("admin_1"), h.Detail)
	router.POST(path+"/:id/retry", setUserID("admin_1"), h.Retry)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(method, target, nil))
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w.Code, resp
}

const attentionEventJSON = `{"accountId":"acct_1","alert":{"attempts":1,"lastError":"","sentAt":"2026-10-24T09:00:00Z","state":"sent"},` +
	`"apiVersion":"2026-08-26.dahlia","attempts":4,"completedAt":null,"created":"2026-10-23T07:59:00Z","eventId":"evt_1",` +
	`"firstWaitAt":"2026-10-23T08:00:00Z","lastError":"unattributed_invoice","livemode":false,"nextAttemptAt":"2026-10-23T09:00:00Z",` +
	`"references":{"chargeId":"","checkoutSessionId":"","customerId":"cus_1","invoiceId":"in_1","paymentIntentId":"","subscriptionId":"sub_1"},` +
	`"status":"needs_attention","type":"invoice.paid"}`

func TestTheWebhookEventListAnswersTheRequestedPage(t *testing.T) {
	store := newEventStore()

	code, resp := serveEventAdmin(t, store, eventEndpoint, http.MethodGet, "/api/admin/webhook-events?status=needs_attention&limit=500&offset=10")

	if code != http.StatusOK || resp["success"] != true {
		t.Fatalf("status = %d, %v; want 200", code, resp)
	}
	if want := (eventadmin.ListQuery{Status: webhookevent.NeedsAttention, Limit: eventadmin.MaxListLimit, Offset: 10}); store.query != want {
		t.Errorf("query = %+v, want %+v", store.query, want)
	}
	if got := asJSON(t, resp["events"]); got != "["+attentionEventJSON+"]" {
		t.Errorf("events = %s\nwant [%s]", got, attentionEventJSON)
	}
}

func TestAWebhookEventListRequestThatIsInvalidIsAnswered400(t *testing.T) {
	cases := []struct {
		name, query, want string
	}{
		{"an unknown status", "status=failed", "status must be pending, processing, waiting_dependency, processed, needs_attention or ignored"},
		{"a limit that is no number", "limit=ten", "limit and offset must be whole numbers"},
		{"an offset that is no number", "offset=1.5", "limit and offset must be whole numbers"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newEventStore()

			code, resp := serveEventAdmin(t, store, eventEndpoint, http.MethodGet, "/api/admin/webhook-events?"+tc.query)

			if code != http.StatusBadRequest || resp["success"] != false || resp["message"] != tc.want {
				t.Errorf("status = %d, %v; want 400 %q", code, resp, tc.want)
			}
			if store.listCalls != 0 {
				t.Errorf("list calls = %d, want none", store.listCalls)
			}
		})
	}
}

func TestTheWebhookEventDetailCarriesItsDeliveriesAndOriginalPayload(t *testing.T) {
	code, resp := serveEventAdmin(t, newEventStore(), eventEndpoint, http.MethodGet, "/api/admin/webhook-events/evt_1")

	if code != http.StatusOK || resp["success"] != true {
		t.Fatalf("status = %d, %v; want 200", code, resp)
	}
	if got := asJSON(t, resp["event"]); got != attentionEventJSON {
		t.Errorf("event = %s\nwant %s", got, attentionEventJSON)
	}
	wantDeliveries := `[{"id":"dlv_1","receivedAt":"2026-10-23T08:00:00Z"},{"id":"dlv_2","receivedAt":"2026-10-23T08:01:00Z"}]`
	if got := asJSON(t, resp["deliveries"]); got != wantDeliveries {
		t.Errorf("deliveries = %s\nwant %s", got, wantDeliveries)
	}
	if got := asJSON(t, resp["payload"]); got != `{"id":"evt_1","object":"event","type":"invoice.paid"}` {
		t.Errorf("payload = %s, want the original payload", got)
	}
}

func TestAProcessedEventShowsWhenItCompletedAndNoAlert(t *testing.T) {
	store := newEventStore()
	store.detail.Event.Task.Status = webhookevent.Processed
	store.detail.Event.Task.CompletedAt = eventNow
	store.detail.Event.Task.Alert = alert.Alert{}

	_, resp := serveEventAdmin(t, store, eventEndpoint, http.MethodGet, "/api/admin/webhook-events/evt_1")

	ev, _ := resp["event"].(map[string]any)
	if ev["completedAt"] != "2026-10-24T09:00:00Z" || ev["alert"] != nil {
		t.Errorf("event = %v, want completedAt 2026-10-24T09:00:00Z and no alert", ev)
	}
}

func TestTheDetailOfAnUnknownWebhookEventIsAnswered404(t *testing.T) {
	code, resp := serveEventAdmin(t, newEventStore(), eventEndpoint, http.MethodGet, "/api/admin/webhook-events/evt_x")

	if code != http.StatusNotFound || resp["message"] != "no webhook event with that ID" {
		t.Errorf("status = %d, %v; want 404", code, resp)
	}
}

func TestARetriedEventIsRequeuedWithItsSentAlertKept(t *testing.T) {
	store := newEventStore()

	code, resp := serveEventAdmin(t, store, eventEndpoint, http.MethodPost, "/api/admin/webhook-events/evt_1/retry")

	if code != http.StatusOK || resp["success"] != true {
		t.Fatalf("status = %d, %v; want 200", code, resp)
	}
	ev, _ := resp["event"].(map[string]any)
	if ev["status"] != "pending" || ev["nextAttemptAt"] != "2026-10-24T09:00:00Z" || ev["firstWaitAt"] != "2026-10-23T08:00:00Z" {
		t.Errorf("event = %v, want pending now with its first wait kept", ev)
	}
	if got := asJSON(t, ev["alert"]); got != `{"attempts":1,"lastError":"","sentAt":"2026-10-24T09:00:00Z","state":"sent"}` {
		t.Errorf("alert = %s, want the sent alert kept", got)
	}
	if store.saves != 1 {
		t.Errorf("saves = %d, want 1", store.saves)
	}
}

func TestARetryThatIsRefusedSavesNothing(t *testing.T) {
	cases := []struct {
		name     string
		id       string
		status   webhookevent.Status
		wantCode int
		wantMsg  string
	}{
		{"an event that needs no attention", "evt_1", webhookevent.Processed,
			http.StatusConflict, "only an event that needs attention can be retried"},
		{"an unknown event", "evt_x", webhookevent.NeedsAttention,
			http.StatusNotFound, "no webhook event with that ID"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newEventStore()
			store.detail.Event.Task.Status = tc.status

			code, resp := serveEventAdmin(t, store, eventEndpoint, http.MethodPost, "/api/admin/webhook-events/"+tc.id+"/retry")

			if code != tc.wantCode || resp["success"] != false || resp["message"] != tc.wantMsg {
				t.Errorf("status = %d, %v; want %d %q", code, resp, tc.wantCode, tc.wantMsg)
			}
			if store.saves != 0 {
				t.Errorf("saves = %d, want none", store.saves)
			}
		})
	}
}

func TestWebhookEventRequestsThatCannotBeServedAreAnswered503(t *testing.T) {
	cases := []struct {
		name, method, target string
	}{
		{"list", http.MethodGet, "/api/admin/webhook-events"},
		{"detail", http.MethodGet, "/api/admin/webhook-events/evt_1"},
		{"retry", http.MethodPost, "/api/admin/webhook-events/evt_1/retry"},
	}
	causes := []struct {
		name     string
		endpoint webhookevent.Endpoint
		err      error
	}{
		{"the store fails", eventEndpoint, errors.New("database is locked")},
		{"the endpoint is not discovered yet", webhookevent.Endpoint{}, nil},
	}
	for _, cause := range causes {
		for _, tc := range cases {
			t.Run(cause.name+"/"+tc.name, func(t *testing.T) {
				store := newEventStore()
				store.err = cause.err

				code, resp := serveEventAdmin(t, store, cause.endpoint, tc.method, tc.target)

				if code != http.StatusServiceUnavailable || resp["success"] != false ||
					resp["message"] != "webhook events are unavailable right now; try again later" {
					t.Errorf("status = %d, %v; want 503", code, resp)
				}
				if store.saves != 0 {
					t.Errorf("saves = %d, want none", store.saves)
				}
			})
		}
	}
}
