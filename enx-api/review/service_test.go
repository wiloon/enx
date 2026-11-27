package review

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

type fakeWord struct {
	count int
	known bool
}

// fakeStore is an in-memory Store for one user and word. A failed fn rolls
// nothing back: atomicity is the adapter's, tested on SQLite.
type fakeStore struct {
	word  fakeWord
	state *State
	logs  []Log
	err   error
}

func (f *fakeStore) Transact(_ context.Context, fn func(Tx) error) error {
	if f.err != nil {
		return f.err
	}
	return fn(f)
}

func (f *fakeStore) Word(string, string) (int, bool, error) {
	return f.word.count, f.word.known, nil
}

func (f *fakeStore) CountLookup(string, string, time.Time) (int, bool, error) {
	f.word = fakeWord{count: f.word.count + 1}
	return f.word.count, false, nil
}

func (f *fakeStore) SetKnown(_, _ string, known bool, _ time.Time) (int, bool, error) {
	f.word.known = known
	return f.word.count, f.word.known, nil
}

func (f *fakeStore) State(string, string) (State, bool, error) {
	if f.state == nil {
		return State{}, false, nil
	}
	return *f.state, true, nil
}

func (f *fakeStore) SaveState(s State) error {
	f.state = &s
	return nil
}

func (f *fakeStore) AddLog(l Log) error {
	f.logs = append(f.logs, l)
	return nil
}

var start = time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)

// clock is a settable time source.
type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

func lookupAt(t *testing.T, s *Service, c *clock, after time.Duration) {
	t.Helper()
	c.at = start.Add(after)
	if _, _, err := s.RecordLookup(context.Background(), "u1", "w1", "popover"); err != nil {
		t.Fatal(err)
	}
}

func rescheduled(logs []Log) string {
	var out []bool
	for _, l := range logs {
		out = append(out, l.Rescheduled != nil && *l.Rescheduled)
	}
	return fmt.Sprint(out)
}

func newTestService() (*Service, *fakeStore, *clock) {
	store, c := &fakeStore{}, &clock{at: start}
	return NewService(store, c.now), store, c
}

func TestFirstLookupLearnsTheWordAsAgain(t *testing.T) {
	s, store, c := newTestService()

	lookupAt(t, s, c, 0)

	st := store.state
	if st == nil || st.UserID != "u1" || st.WordID != "w1" || st.Reps != 1 || st.Lapses != 0 {
		t.Fatalf("state %+v, want one review of u1/w1 and no lapse", st)
	}
	// go-fsrs default parameters: a new card answered Again is due in a day.
	if !st.Due.Equal(start.Add(24*time.Hour)) || !st.LastReview.Equal(start) {
		t.Fatalf("due %v, last review %v", st.Due, st.LastReview)
	}
	want := Log{UserID: "u1", WordID: "w1", At: start, Type: SignalLookup, Source: SourcePopover}
	got := store.logs[0]
	got.Rescheduled = nil
	if len(store.logs) != 1 || got != want || rescheduled(store.logs) != "[true]" {
		t.Fatalf("logs %+v", store.logs)
	}
}

func TestALaterLookupReschedulesAsAgain(t *testing.T) {
	s, store, c := newTestService()
	lookupAt(t, s, c, 0)
	first := *store.state

	lookupAt(t, s, c, 48*time.Hour)

	st := store.state
	if st.Reps != 2 || !st.LastReview.Equal(c.at) || !st.Due.After(c.at) {
		t.Fatalf("state %+v, want a second review", st)
	}
	// Again on a card that has a state lowers its stability or keeps it.
	if st.Stability > first.Stability || st.Difficulty <= first.Difficulty {
		t.Fatalf("stability %v -> %v, difficulty %v -> %v; want an Again", first.Stability, st.Stability, first.Difficulty, st.Difficulty)
	}
	if st.Lapses != 0 {
		t.Fatalf("lapses %d: go-fsrs lapses are not review lapses", st.Lapses)
	}
}

// The window runs from the last lookup that rescheduled; suppressed lookups
// do not extend it.
func TestRepeatLookupsInsideTheWindowDoNotReschedule(t *testing.T) {
	s, store, c := newTestService()
	lookupAt(t, s, c, 0)
	first := *store.state

	lookupAt(t, s, c, RescheduleWindow/2)
	lookupAt(t, s, c, RescheduleWindow-time.Second)
	if *store.state != first {
		t.Fatalf("state %+v, want %+v unchanged", *store.state, first)
	}
	lookupAt(t, s, c, RescheduleWindow)

	if store.state.Reps != 2 || store.word.count != 4 {
		t.Fatalf("reps %d, count %d; want 2 and 4", store.state.Reps, store.word.count)
	}
	if got := rescheduled(store.logs); got != "[true false false true]" {
		t.Fatalf("rescheduled %s", got)
	}
}

// A review answer does not open the window: only a lookup does.
func TestAStateNotRescheduledByALookupIsRescheduled(t *testing.T) {
	s, store, _ := newTestService()
	store.state = &State{UserID: "u1", WordID: "w1", Stability: 3, Difficulty: 5, Phase: 2,
		Due: start.Add(72 * time.Hour), LastReview: start.Add(-2 * time.Minute), Reps: 1}

	if _, _, err := s.RecordLookup(context.Background(), "u1", "w1", ""); err != nil {
		t.Fatal(err)
	}

	if store.state.Reps != 2 || rescheduled(store.logs) != "[true]" {
		t.Fatalf("state %+v, logs %+v; want rescheduled", store.state, store.logs)
	}
}

func TestALookupOfAKnownWordIsALapseAndNeverSuppressed(t *testing.T) {
	s, store, c := newTestService()
	lookupAt(t, s, c, 0)
	store.word.known = true

	lookupAt(t, s, c, time.Minute)

	st := store.state
	if st.Lapses != 1 || !st.LastLapseAt.Equal(c.at) || st.Reps != 2 || store.word.known {
		t.Fatalf("state %+v, known %v; want one lapse, rescheduled, back in review", st, store.word.known)
	}
	if got := store.logs[1]; got.Type != SignalLapseLookup || rescheduled(store.logs) != "[true true]" {
		t.Fatalf("logs %+v", store.logs)
	}
}

func TestSetKnownLogsOnlyAChangeAndLeavesTheState(t *testing.T) {
	s, store, _ := newTestService()
	for _, known := range []bool{false, true, true, false, false} {
		if _, got, err := s.SetKnown(context.Background(), "u1", "w1", known, "word_list"); err != nil || got != known {
			t.Fatalf("SetKnown(%v) = %v, %v", known, got, err)
		}
	}

	var types []Signal
	for _, l := range store.logs {
		types = append(types, l.Type)
	}
	if fmt.Sprint(types) != fmt.Sprint([]Signal{SignalKnow, SignalUnknow}) || store.state != nil {
		t.Fatalf("logs %v, state %+v; want know then unknow and no state", types, store.state)
	}
}

func TestParseSource(t *testing.T) {
	for raw, want := range map[string]Source{
		"popover": SourcePopover, "word_list": SourceWordList,
		"": SourceUnknown, "review": SourceUnknown, "Popover": SourceUnknown,
	} {
		if got := ParseSource(raw); got != want {
			t.Errorf("ParseSource(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestAFailedTransactionIsReturned(t *testing.T) {
	s, store, _ := newTestService()
	store.err = errors.New("db down")

	_, _, lookupErr := s.RecordLookup(context.Background(), "u1", "w1", "")
	_, _, knownErr := s.SetKnown(context.Background(), "u1", "w1", true, "")

	if !errors.Is(lookupErr, store.err) || !errors.Is(knownErr, store.err) {
		t.Fatalf("errors %v, %v; want the store's", lookupErr, knownErr)
	}
}
