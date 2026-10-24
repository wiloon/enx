package billingsupport

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/conflict"
)

var (
	now      = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	earlier  = time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	firstAsk = conflict.Support{Message: "I was charged twice.", At: earlier}
)

// fakeStore keeps subscription rows and applies a save only while the row is
// still at the version the caller read, as the conditional write would.
type fakeStore struct {
	rows    map[string]Record
	saves   []Save
	readErr error
	saveErr error
	// beforeSave runs inside SaveSupport before the version check, to let
	// another request commit first.
	beforeSave func(s *fakeStore)
}

func newFakeStore(id string, r Record) *fakeStore {
	return &fakeStore{rows: map[string]Record{id: r}}
}

func (s *fakeStore) Subscription(_ context.Context, id string) (Record, error) {
	if s.readErr != nil {
		return Record{}, s.readErr
	}
	r, ok := s.rows[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	return r, nil
}

func (s *fakeStore) SaveSupport(_ context.Context, save Save) error {
	if s.beforeSave != nil {
		s.beforeSave(s)
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
	r.Subscription.Support = save.Support
	r.Alert = save.Alert
	s.rows[save.SubscriptionID] = r
	return nil
}

func ownedConflict(version int64) Record {
	return Record{Version: version, Subscription: conflict.Subscription{OwnerID: "user_1", Conflict: true}}
}

func request(s *fakeStore, userID, subscriptionID, message string) (conflict.Support, error) {
	return New(s, func() time.Time { return now }).Request(context.Background(), userID, subscriptionID, message)
}

func TestTheFirstRequestSavesTheMessageWithAPendingSupportAlert(t *testing.T) {
	store := newFakeStore("sub_b", ownedConflict(7))

	got, err := request(store, "user_1", "sub_b", "  I was charged twice.\n")

	if err != nil {
		t.Fatal(err)
	}
	want := conflict.Support{Message: "I was charged twice.", At: now}
	if got != want {
		t.Errorf("support = %+v, want %+v", got, want)
	}
	wantSave := Save{SubscriptionID: "sub_b", Version: 7, Support: want, Alert: alert.Alert{State: alert.Pending, NextAttemptAt: now}}
	if len(store.saves) != 1 || store.saves[0] != wantSave {
		t.Errorf("saves = %+v, want one %+v", store.saves, wantSave)
	}
}

func TestARepeatedRequestReturnsTheFirstAndRaisesNothing(t *testing.T) {
	r := ownedConflict(8)
	r.Subscription.Support = firstAsk
	r.Alert = alert.Alert{State: alert.Sent, Attempts: 1, SentAt: earlier}
	store := newFakeStore("sub_b", r)

	got, err := request(store, "user_1", "sub_b", "Hello again?")

	if err != nil || got != firstAsk {
		t.Errorf("Request = %+v, %v; want the first request %+v", got, err, firstAsk)
	}
	if len(store.saves) != 0 {
		t.Errorf("saves = %+v, want none", store.saves)
	}
}

func TestARequestTheRulesRefuseSavesNothing(t *testing.T) {
	cases := []struct {
		name           string
		userID         string
		subscriptionID string
		message        string
		wantErr        error
	}{
		{"another user's conflict", "user_2", "sub_b", "Not mine.", conflict.ErrNotOwnedConflict},
		{"a subscription ENX has no row for", "user_1", "sub_unknown", "Help.", conflict.ErrNotOwnedConflict},
		{"a blank message", "user_1", "sub_b", " \n", conflict.ErrBlankMessage},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore("sub_b", ownedConflict(1))

			_, err := request(store, tc.userID, tc.subscriptionID, tc.message)

			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v, want %v", err, tc.wantErr)
			}
			if len(store.saves) != 0 {
				t.Errorf("saves = %+v, want none", store.saves)
			}
		})
	}
}

func TestAConcurrentFirstRequestWinsAndTheOtherReturnsIt(t *testing.T) {
	store := newFakeStore("sub_b", ownedConflict(3))
	store.beforeSave = func(s *fakeStore) {
		s.beforeSave = nil
		r := s.rows["sub_b"]
		r.Version++
		r.Subscription.Support = firstAsk
		r.Alert = alert.Alert{State: alert.Pending, NextAttemptAt: earlier}
		s.rows["sub_b"] = r
	}

	got, err := request(store, "user_1", "sub_b", "Me too.")

	if err != nil || got != firstAsk {
		t.Errorf("Request = %+v, %v; want the request that committed first %+v", got, err, firstAsk)
	}
	if len(store.saves) != 0 {
		t.Errorf("saves = %+v, want none: the winner's alert stands", store.saves)
	}
}

func TestARequestTheStoreCannotServeIsUnavailable(t *testing.T) {
	cases := []struct {
		name  string
		setup func(s *fakeStore)
	}{
		{"the read fails", func(s *fakeStore) { s.readErr = errors.New("database is locked") }},
		{"the save fails", func(s *fakeStore) { s.saveErr = errors.New("database is locked") }},
		{"the row keeps moving under every save", func(s *fakeStore) {
			var bump func(s *fakeStore)
			bump = func(s *fakeStore) {
				r := s.rows["sub_b"]
				r.Version++
				s.rows["sub_b"] = r
				s.beforeSave = bump
			}
			s.beforeSave = bump
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore("sub_b", ownedConflict(1))
			tc.setup(store)

			_, err := request(store, "user_1", "sub_b", "Help.")

			if !errors.Is(err, ErrUnavailable) {
				t.Errorf("err = %v, want ErrUnavailable", err)
			}
			if len(store.saves) != 0 {
				t.Errorf("saves = %+v, want none", store.saves)
			}
		})
	}
}
