package conflictadmin

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/conflict"
	"enx-api/billing/webhookevent"
)

var (
	discovered = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	now        = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
)

// fakeStore holds subscription conflicts by Subscription ID and applies a
// resolution only at the version that was read, like the conditional write
// of the real store.
type fakeStore struct {
	rows      map[string]*Record
	events    map[string][]Event
	saves     []ResolutionSave
	lastQuery *conflict.ListQuery

	readErr, saveErr, eventsErr, listErr error
	// beforeSave runs before a save is applied, to model a concurrent write.
	beforeSave func(s *fakeStore)
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		rows: map[string]*Record{
			"sub_b": {Version: 7, Conflict: Conflict{
				SubscriptionID:         "sub_b",
				AcceptedSubscriptionID: "sub_a",
				OwnerID:                "user_1",
				CustomerID:             "cus_1",
				StripeStatus:           "active",
				Reason:                 "second_live_subscription",
				DiscoveredAt:           discovered,
				Resolution:             conflict.Resolution{Status: conflict.Open},
			}},
		},
		events: map[string][]Event{
			"sub_b": {{
				EventID:    "evt_1",
				Type:       "invoice.paid",
				Status:     webhookevent.Processed,
				Attempts:   1,
				Deliveries: []Delivery{{ID: "dlv_1", ReceivedAt: discovered}, {ID: "dlv_2", ReceivedAt: discovered.Add(time.Minute)}},
			}},
		},
	}
}

func (s *fakeStore) ListConflicts(_ context.Context, q conflict.ListQuery) ([]Conflict, error) {
	s.lastQuery = &q
	if s.listErr != nil {
		return nil, s.listErr
	}
	var out []Conflict
	for _, r := range s.rows {
		if q.Status == "" || r.Conflict.Resolution.Status == q.Status {
			out = append(out, r.Conflict)
		}
	}
	return out, nil
}

func (s *fakeStore) Conflict(_ context.Context, id string) (Record, error) {
	if s.readErr != nil {
		return Record{}, s.readErr
	}
	r, ok := s.rows[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	return *r, nil
}

func (s *fakeStore) Events(_ context.Context, id string) ([]Event, error) {
	if s.eventsErr != nil {
		return nil, s.eventsErr
	}
	return s.events[id], nil
}

func (s *fakeStore) SaveResolution(_ context.Context, save ResolutionSave) error {
	if s.beforeSave != nil {
		hook := s.beforeSave
		s.beforeSave = nil
		hook(s)
	}
	if s.saveErr != nil {
		return s.saveErr
	}
	r := s.rows[save.SubscriptionID]
	if r.Version != save.Version {
		return ErrStale
	}
	s.saves = append(s.saves, save)
	r.Version++
	r.Conflict.Resolution = save.Resolution
	return nil
}

func newService(s *fakeStore) *Service {
	return New(s, func() time.Time { return now })
}

func resolveReq(notes string) conflict.ResolveRequest {
	return conflict.ResolveRequest{Status: "resolved", Notes: notes}
}

func TestTheListAsksTheStoreForTheBoundedPage(t *testing.T) {
	store := newFakeStore()

	got, err := newService(store).List(context.Background(), "open", 500, -3)

	if err != nil {
		t.Fatalf("List: %v", err)
	}
	want := conflict.ListQuery{Status: conflict.Open, Limit: conflict.MaxListLimit, Offset: 0}
	if store.lastQuery == nil || *store.lastQuery != want {
		t.Errorf("query = %+v, want %+v", store.lastQuery, want)
	}
	if len(got) != 1 || got[0].SubscriptionID != "sub_b" {
		t.Errorf("List = %+v, want sub_b", got)
	}
}

func TestTheListRefusesAnUnknownStatusWithoutReading(t *testing.T) {
	store := newFakeStore()

	_, err := newService(store).List(context.Background(), "closed", 0, 0)

	if !errors.Is(err, conflict.ErrInvalidStatus) {
		t.Errorf("err = %v, want ErrInvalidStatus", err)
	}
	if store.lastQuery != nil {
		t.Errorf("store was queried with %+v, want no read", store.lastQuery)
	}
}

func TestTheDetailCarriesTheConflictAndItsEventsWithTheirDeliveries(t *testing.T) {
	store := newFakeStore()

	got, err := newService(store).Detail(context.Background(), "sub_b")

	if err != nil {
		t.Fatalf("Detail: %v", err)
	}
	want := Detail{Conflict: store.rows["sub_b"].Conflict, Events: store.events["sub_b"]}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Detail = %+v, want %+v", got, want)
	}
}

func TestTheDetailOfASubscriptionThatIsNoConflictIsNotFound(t *testing.T) {
	_, err := newService(newFakeStore()).Detail(context.Background(), "sub_x")

	if !errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnavailable) {
		t.Errorf("err = %v, want only ErrNotFound", err)
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
		{"detail row", func(s *fakeStore) { s.readErr = failure }, func(svc *Service) error {
			_, err := svc.Detail(context.Background(), "sub_b")
			return err
		}},
		{"detail events", func(s *fakeStore) { s.eventsErr = failure }, func(svc *Service) error {
			_, err := svc.Detail(context.Background(), "sub_b")
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

func TestTheFirstResolutionIsSavedWithTheOperatorAndTimeAtTheReadVersion(t *testing.T) {
	store := newFakeStore()

	got, err := newService(store).Resolve(context.Background(), "admin_1", "sub_b", resolveReq("  Refunded sub_b in Stripe.  "))

	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	want := conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_1", ResolvedAt: now, Notes: "Refunded sub_b in Stripe."}
	if got != want {
		t.Errorf("Resolve = %+v, want %+v", got, want)
	}
	if !reflect.DeepEqual(store.saves, []ResolutionSave{{SubscriptionID: "sub_b", Version: 7, Resolution: want}}) {
		t.Errorf("saves = %+v, want one at version 7", store.saves)
	}
}

func TestAnIdenticalRepeatedResolutionKeepsTheFirstAndSavesNothing(t *testing.T) {
	store := newFakeStore()
	svc := newService(store)
	first, _ := svc.Resolve(context.Background(), "admin_1", "sub_b", resolveReq("Refunded."))

	got, err := New(store, func() time.Time { return now.Add(time.Hour) }).
		Resolve(context.Background(), "admin_2", "sub_b", resolveReq("Refunded."))

	if err != nil || got != first {
		t.Errorf("Resolve = %+v, %v; want the first resolution %+v", got, err, first)
	}
	if len(store.saves) != 1 {
		t.Errorf("saves = %d, want only the first", len(store.saves))
	}
}

func TestAResolutionTheRulesRefuseSavesNothing(t *testing.T) {
	cases := []struct {
		name string
		id   string
		req  conflict.ResolveRequest
		want error
	}{
		{"different notes on a resolved conflict", "sub_b", resolveReq("Something else."), conflict.ErrResolutionDiffers},
		{"a status other than resolved", "sub_b", conflict.ResolveRequest{Status: "open", Notes: "Reopen."}, conflict.ErrInvalidStatus},
		{"blank notes", "sub_b", resolveReq("   "), conflict.ErrBlankNotes},
		{"a subscription that is no conflict", "sub_x", resolveReq("Refunded."), ErrNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			if tc.want == conflict.ErrResolutionDiffers {
				store.rows["sub_b"].Conflict.Resolution = conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_1", ResolvedAt: discovered, Notes: "Refunded."}
			}

			_, err := newService(store).Resolve(context.Background(), "admin_1", tc.id, tc.req)

			if !errors.Is(err, tc.want) || errors.Is(err, ErrUnavailable) {
				t.Errorf("err = %v, want only %v", err, tc.want)
			}
			if len(store.saves) != 0 {
				t.Errorf("saves = %+v, want none", store.saves)
			}
		})
	}
}

func TestAConcurrentResolutionThatCommittedFirstStands(t *testing.T) {
	committed := conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_2", ResolvedAt: discovered, Notes: "Refunded."}
	cases := []struct {
		name    string
		notes   string
		want    conflict.Resolution
		wantErr error
	}{
		{"with the same notes", "Refunded.", committed, nil},
		{"with other notes", "Cancelled.", conflict.Resolution{}, conflict.ErrResolutionDiffers},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			store.beforeSave = func(s *fakeStore) {
				r := s.rows["sub_b"]
				r.Version++
				r.Conflict.Resolution = committed
			}

			got, err := newService(store).Resolve(context.Background(), "admin_1", "sub_b", resolveReq(tc.notes))

			if !errors.Is(err, tc.wantErr) || (tc.wantErr == nil && got != tc.want) {
				t.Errorf("Resolve = %+v, %v; want %+v, %v", got, err, tc.want, tc.wantErr)
			}
			if store.rows["sub_b"].Conflict.Resolution != committed {
				t.Errorf("stored = %+v, want the committed %+v", store.rows["sub_b"].Conflict.Resolution, committed)
			}
		})
	}
}

func TestAResolutionTheStoreCannotServeIsUnavailable(t *testing.T) {
	cases := []struct {
		name string
		fail func(*fakeStore)
	}{
		{"read fails", func(s *fakeStore) { s.readErr = errors.New("database is locked") }},
		{"save fails", func(s *fakeStore) { s.saveErr = errors.New("database is locked") }},
		{"the row keeps moving", func(s *fakeStore) {
			var move func(*fakeStore)
			move = func(s *fakeStore) {
				s.rows["sub_b"].Version++
				s.beforeSave = move
			}
			s.beforeSave = move
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			tc.fail(store)

			_, err := newService(store).Resolve(context.Background(), "admin_1", "sub_b", resolveReq("Refunded."))

			if !errors.Is(err, ErrUnavailable) {
				t.Errorf("err = %v, want ErrUnavailable", err)
			}
			if len(store.saves) != 0 {
				t.Errorf("saves = %+v, want none", store.saves)
			}
		})
	}
}
