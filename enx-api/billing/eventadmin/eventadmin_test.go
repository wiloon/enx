package eventadmin

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/webhookevent"
)

var (
	received = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	now      = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	endpoint = webhookevent.Endpoint{AccountID: "acct_1", Livemode: false}
)

func TestParseListQuery(t *testing.T) {
	cases := []struct {
		name    string
		status  string
		limit   int
		offset  int
		want    ListQuery
		wantErr error
	}{
		{name: "defaults list events that need attention, 50 at a time from the newest", want: ListQuery{Status: webhookevent.NeedsAttention, Limit: DefaultListLimit}},
		{name: "another status", status: "waiting_dependency", limit: 10, offset: 20, want: ListQuery{Status: webhookevent.WaitingDependency, Limit: 10, Offset: 20}},
		{name: "ignored events keep their reason and can be listed", status: "ignored", want: ListQuery{Status: webhookevent.Ignored, Limit: DefaultListLimit}},
		{name: "the limit is capped", limit: 1000, want: ListQuery{Status: webhookevent.NeedsAttention, Limit: MaxListLimit}},
		{name: "a negative limit takes the default", limit: -1, want: ListQuery{Status: webhookevent.NeedsAttention, Limit: DefaultListLimit}},
		{name: "a negative offset starts at the newest", offset: -5, want: ListQuery{Status: webhookevent.NeedsAttention, Limit: DefaultListLimit}},
		{name: "an unknown status is refused", status: "failed", wantErr: ErrInvalidStatus},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseListQuery(tc.status, tc.limit, tc.offset)

			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("ParseListQuery = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// fakeStore holds webhook events by scope and saves a task only while the
// stored one still matches what was read, like TaskStore.Save.
type fakeStore struct {
	events map[webhookevent.Scope]*Detail
	saves  []webhookevent.Task

	lastEndpoint *webhookevent.Endpoint
	lastQuery    *ListQuery
	lastRead     *webhookevent.Scope

	listErr, readErr, saveErr error
	// beforeSave runs before a save is applied, to model a concurrent write.
	beforeSave func(s *fakeStore)
}

var attentionScope = endpoint.Scope("evt_1")

func attentionDetail() *Detail {
	return &Detail{
		Event: Event{
			Scope:      attentionScope,
			APIVersion: "2026-08-26.dahlia",
			Created:    received.Add(-time.Minute),
			Refs:       webhookevent.References{SubscriptionID: "sub_1", CustomerID: "cus_1", InvoiceID: "in_1"},
			Task: webhookevent.Task{
				Type:           "invoice.paid",
				SubscriptionID: "sub_1",
				Status:         webhookevent.NeedsAttention,
				Attempts:       4,
				LastError:      "unattributed_invoice",
				FirstWaitAt:    received,
				NextAttemptAt:  received.Add(time.Hour),
				Alert:          alert.Alert{State: alert.Sent, Attempts: 1, SentAt: received.Add(25 * time.Hour)},
			},
		},
		Deliveries: []Delivery{{ID: "dlv_1", ReceivedAt: received}, {ID: "dlv_2", ReceivedAt: received.Add(time.Minute)}},
		Payload:    json.RawMessage(`{"id":"evt_1","object":"event","type":"invoice.paid"}`),
	}
}

func newFakeStore() *fakeStore {
	return &fakeStore{events: map[webhookevent.Scope]*Detail{attentionScope: attentionDetail()}}
}

func (s *fakeStore) ListEvents(_ context.Context, e webhookevent.Endpoint, q ListQuery) ([]Event, error) {
	s.lastEndpoint, s.lastQuery = &e, &q
	if s.listErr != nil {
		return nil, s.listErr
	}
	var out []Event
	for _, d := range s.events {
		if d.Event.Task.Status == q.Status {
			out = append(out, d.Event)
		}
	}
	return out, nil
}

func (s *fakeStore) Event(_ context.Context, scope webhookevent.Scope) (Detail, error) {
	s.lastRead = &scope
	if s.readErr != nil {
		return Detail{}, s.readErr
	}
	d, ok := s.events[scope]
	if !ok {
		return Detail{}, ErrNotFound
	}
	return *d, nil
}

func (s *fakeStore) Save(_ context.Context, scope webhookevent.Scope, read, next webhookevent.Task, effects webhookevent.Effects) error {
	if s.beforeSave != nil {
		hook := s.beforeSave
		s.beforeSave = nil
		hook(s)
	}
	if s.saveErr != nil {
		return s.saveErr
	}
	if effects != nil {
		return errors.New("an operator retry carries no effects")
	}
	d := s.events[scope]
	stored := d.Event.Task
	if stored.Status != read.Status || stored.Attempts != read.Attempts || stored.ClaimToken != read.ClaimToken {
		return webhookevent.ErrStaleClaim
	}
	next.Alert = webhookevent.AlertToSave(stored.Alert, next.Alert)
	s.saves = append(s.saves, next)
	d.Event.Task = next
	return nil
}

func newService(s *fakeStore) *Service {
	return New(s, func() webhookevent.Endpoint { return endpoint }, func() time.Time { return now })
}

func TestTheListAsksTheStoreForTheBoundedPageOfThisEndpoint(t *testing.T) {
	store := newFakeStore()

	got, err := newService(store).List(context.Background(), "", 500, -3)

	if err != nil {
		t.Fatalf("List: %v", err)
	}
	want := ListQuery{Status: webhookevent.NeedsAttention, Limit: MaxListLimit, Offset: 0}
	if store.lastQuery == nil || *store.lastQuery != want {
		t.Errorf("query = %+v, want %+v", store.lastQuery, want)
	}
	if store.lastEndpoint == nil || *store.lastEndpoint != endpoint {
		t.Errorf("endpoint = %+v, want %+v", store.lastEndpoint, endpoint)
	}
	if len(got) != 1 || got[0].Scope != attentionScope {
		t.Errorf("List = %+v, want evt_1", got)
	}
}

func TestTheListRefusesAnUnknownStatusWithoutReading(t *testing.T) {
	store := newFakeStore()

	_, err := newService(store).List(context.Background(), "failed", 0, 0)

	if !errors.Is(err, ErrInvalidStatus) {
		t.Errorf("err = %v, want ErrInvalidStatus", err)
	}
	if store.lastQuery != nil {
		t.Errorf("store was queried with %+v, want no read", store.lastQuery)
	}
}

func TestTheDetailCarriesTheEventItsDeliveriesAndOriginalPayload(t *testing.T) {
	store := newFakeStore()

	got, err := newService(store).Detail(context.Background(), "evt_1")

	if err != nil {
		t.Fatalf("Detail: %v", err)
	}
	if !reflect.DeepEqual(got, *attentionDetail()) {
		t.Errorf("Detail = %+v, want %+v", got, *attentionDetail())
	}
	if store.lastRead == nil || *store.lastRead != attentionScope {
		t.Errorf("read scope = %+v, want %+v", store.lastRead, attentionScope)
	}
}

func TestTheDetailOfAnUnknownEventIsNotFound(t *testing.T) {
	_, err := newService(newFakeStore()).Detail(context.Background(), "evt_x")

	if !errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnavailable) {
		t.Errorf("err = %v, want only ErrNotFound", err)
	}
}

func TestBeforeTheEndpointIsDiscoveredNothingIsReadOrRetried(t *testing.T) {
	cases := []struct {
		name string
		call func(*Service) error
	}{
		{"list", func(svc *Service) error {
			_, err := svc.List(context.Background(), "", 0, 0)
			return err
		}},
		{"detail", func(svc *Service) error {
			_, err := svc.Detail(context.Background(), "evt_1")
			return err
		}},
		{"retry", func(svc *Service) error {
			_, err := svc.Retry(context.Background(), "evt_1")
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			undiscovered := func() webhookevent.Endpoint { return webhookevent.Endpoint{Livemode: false} }

			err := tc.call(New(store, undiscovered, func() time.Time { return now }))

			if !errors.Is(err, ErrUnavailable) || !errors.Is(err, webhookevent.ErrEndpointUnknown) {
				t.Errorf("err = %v, want ErrUnavailable for an unknown endpoint", err)
			}
			if store.lastQuery != nil || store.lastRead != nil || len(store.saves) != 0 {
				t.Errorf("store was used: query %+v, read %+v, saves %+v", store.lastQuery, store.lastRead, store.saves)
			}
		})
	}
}

func TestReadsTheStoreCannotServeAreUnavailable(t *testing.T) {
	failure := errors.New("database is locked")
	cases := []struct {
		name string
		fail func(*fakeStore)
		call func(*Service) error
	}{
		{"list", func(s *fakeStore) { s.listErr = failure }, func(svc *Service) error {
			_, err := svc.List(context.Background(), "", 0, 0)
			return err
		}},
		{"detail", func(s *fakeStore) { s.readErr = failure }, func(svc *Service) error {
			_, err := svc.Detail(context.Background(), "evt_1")
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			tc.fail(store)

			err := tc.call(newService(store))

			if !errors.Is(err, ErrUnavailable) {
				t.Errorf("err = %v, want ErrUnavailable", err)
			}
		})
	}
}

func TestARetryRequeuesTheSameEventAndKeepsItsClockAndSentAlert(t *testing.T) {
	store := newFakeStore()
	before := attentionDetail().Event.Task

	got, err := newService(store).Retry(context.Background(), "evt_1")

	if err != nil {
		t.Fatalf("Retry: %v", err)
	}
	want := before
	want.Status = webhookevent.Pending
	want.NextAttemptAt = now
	if !reflect.DeepEqual(got.Task, want) {
		t.Errorf("retried task = %+v\nwant %+v", got.Task, want)
	}
	if got.Scope != attentionScope {
		t.Errorf("retried scope = %+v, want the same event %+v", got.Scope, attentionScope)
	}
	if !reflect.DeepEqual(store.saves, []webhookevent.Task{want}) {
		t.Errorf("saves = %+v, want one save of %+v", store.saves, want)
	}
}

func TestARetryOfAnEventThatNeedsNoAttentionSavesNothing(t *testing.T) {
	for _, status := range []webhookevent.Status{webhookevent.Pending, webhookevent.Processing, webhookevent.WaitingDependency, webhookevent.Processed, webhookevent.Ignored} {
		t.Run(string(status), func(t *testing.T) {
			store := newFakeStore()
			store.events[attentionScope].Event.Task.Status = status

			_, err := newService(store).Retry(context.Background(), "evt_1")

			if !errors.Is(err, ErrNotRetryable) || errors.Is(err, ErrUnavailable) {
				t.Errorf("err = %v, want only ErrNotRetryable", err)
			}
			if len(store.saves) != 0 {
				t.Errorf("saves = %+v, want none", store.saves)
			}
		})
	}
}

func TestARetryOfAnUnknownEventIsNotFound(t *testing.T) {
	store := newFakeStore()

	_, err := newService(store).Retry(context.Background(), "evt_x")

	if !errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnavailable) {
		t.Errorf("err = %v, want only ErrNotFound", err)
	}
}

func TestARetryThatLostARaceIsJudgedAgainstWhatCommitted(t *testing.T) {
	store := newFakeStore()
	store.beforeSave = func(s *fakeStore) {
		task := &s.events[attentionScope].Event.Task
		task.Status = webhookevent.Pending
		task.NextAttemptAt = now.Add(-time.Second)
	}

	_, err := newService(store).Retry(context.Background(), "evt_1")

	if !errors.Is(err, ErrNotRetryable) || errors.Is(err, ErrUnavailable) {
		t.Errorf("err = %v, want only ErrNotRetryable after another retry committed", err)
	}
	if len(store.saves) != 0 {
		t.Errorf("saves = %+v, want none", store.saves)
	}
}

func TestARetryTheStoreCannotServeIsUnavailable(t *testing.T) {
	cases := []struct {
		name string
		fail func(*fakeStore)
	}{
		{"read fails", func(s *fakeStore) { s.readErr = errors.New("database is locked") }},
		{"save fails", func(s *fakeStore) { s.saveErr = errors.New("database is locked") }},
		{"the task keeps moving", func(s *fakeStore) {
			var move func(*fakeStore)
			move = func(s *fakeStore) {
				s.events[attentionScope].Event.Task.Attempts++
				s.beforeSave = move
			}
			s.beforeSave = move
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			tc.fail(store)

			_, err := newService(store).Retry(context.Background(), "evt_1")

			if !errors.Is(err, ErrUnavailable) {
				t.Errorf("err = %v, want ErrUnavailable", err)
			}
			if len(store.saves) != 0 {
				t.Errorf("saves = %+v, want none", store.saves)
			}
		})
	}
}
