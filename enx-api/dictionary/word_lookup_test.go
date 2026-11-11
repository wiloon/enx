package dictionary

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/stats"
)

// fakeQueryCounts is an in-memory words table plus user_dicts query counts.
type fakeQueryCounts struct {
	words     map[string]bool
	counts    map[string]int // userID+"/"+wordID -> query count
	existsErr error
	recordErr error
}

func newFakeQueryCounts(wordIDs ...string) *fakeQueryCounts {
	q := &fakeQueryCounts{words: map[string]bool{}, counts: map[string]int{}}
	for _, id := range wordIDs {
		q.words[id] = true
	}
	return q
}

func (q *fakeQueryCounts) WordExists(_ context.Context, wordID string) (bool, error) {
	if q.existsErr != nil {
		return false, q.existsErr
	}
	return q.words[wordID], nil
}

func (q *fakeQueryCounts) RecordWordLookup(_ context.Context, userID, wordID string) (int, bool, error) {
	if q.recordErr != nil {
		return 0, false, q.recordErr
	}
	q.counts[userID+"/"+wordID]++
	return q.counts[userID+"/"+wordID], false, nil
}

// fakeLookupEvents is an in-memory lookup event log.
type fakeLookupEvents struct {
	events []LookupEvent
	err    error
}

func (f *fakeLookupEvents) Add(_ context.Context, e LookupEvent) error {
	if f.err != nil {
		return f.err
	}
	f.events = append(f.events, e)
	return nil
}

func newTestWordLookups(counts *fakeQueryCounts, meter Meter, events *fakeLookupEvents) *WordLookups {
	return NewWordLookups(counts, meter, events, func() time.Time { return noon })
}

func TestWordLookupChargesOneCountsAndWritesAnAllowedEvent(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	meter := &fakeMeter{}
	events := &fakeLookupEvents{}

	qc, known, err := newTestWordLookups(counts, meter, events).Record(stats.WithOffset(context.Background(), 480), "u1", "w1")

	if err != nil || qc != 1 || known {
		t.Fatalf("Record = %d, %v, %v; want 1, false, nil", qc, known, err)
	}
	if len(meter.charges) != 1 || meter.charges[0] != 1 {
		t.Fatalf("charges %v, want [1]", meter.charges)
	}
	want := LookupEvent{UserID: "u1", At: noon, TZOffsetMinutes: 480, Outcome: OutcomeAllowed}
	if len(events.events) != 1 || events.events[0] != want {
		t.Fatalf("events %+v, want [%+v]", events.events, want)
	}
}

func TestWordLookupOverQuotaLeavesTheCountAndWritesNoEvent(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	events := &fakeLookupEvents{}

	_, _, err := newTestWordLookups(counts, &fakeMeter{err: ErrQuotaExceeded}, events).Record(context.Background(), "u1", "w1")

	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("err = %v, want ErrQuotaExceeded", err)
	}
	if n := counts.counts["u1/w1"]; n != 0 || len(events.events) != 0 {
		t.Fatalf("query count %d, events %v; want 0 and none", n, events.events)
	}
}

func TestWordLookupOfAnUnknownWordIsNotFoundAndNotCharged(t *testing.T) {
	meter := &fakeMeter{}
	events := &fakeLookupEvents{}

	_, _, err := newTestWordLookups(newFakeQueryCounts(), meter, events).Record(context.Background(), "u1", "no-such-word")

	if !errors.Is(err, ErrWordNotFound) {
		t.Fatalf("err = %v, want ErrWordNotFound", err)
	}
	if len(meter.charges) != 0 || len(events.events) != 0 {
		t.Fatalf("charges %v, events %v; want none", meter.charges, events.events)
	}
}

func TestWordLookupWhoseExistenceCheckFailsIsNotCharged(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	counts.existsErr = errors.New("db down")
	meter := &fakeMeter{}

	_, _, err := newTestWordLookups(counts, meter, &fakeLookupEvents{}).Record(context.Background(), "u1", "w1")

	if err == nil {
		t.Fatal("err = nil, want the existence check's error")
	}
	if len(meter.charges) != 0 {
		t.Fatalf("charges %v, want none", meter.charges)
	}
}

// ADR-029 E2: a meter that fails for any reason other than the quota lets
// the lookup through.
func TestWordLookupFailsOpenWhenTheMeterErrors(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	events := &fakeLookupEvents{}

	qc, _, err := newTestWordLookups(counts, &fakeMeter{err: errors.New("db down")}, events).Record(context.Background(), "u1", "w1")

	if err != nil || qc != 1 || len(events.events) != 1 {
		t.Fatalf("Record = %d, %v with %d events; want 1, nil and one event", qc, err, len(events.events))
	}
}

// The charge stands when the count can't be raised, and no event is
// written for a lookup that was not counted.
func TestWordLookupStaysChargedWithoutAnEventWhenTheCountFails(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	counts.recordErr = errors.New("db down")
	meter := &fakeMeter{}
	events := &fakeLookupEvents{}

	_, _, err := newTestWordLookups(counts, meter, events).Record(context.Background(), "u1", "w1")

	if err == nil || errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrWordNotFound) {
		t.Fatalf("err = %v, want the record error", err)
	}
	if len(meter.charges) != 1 || len(events.events) != 0 {
		t.Fatalf("charges %v, events %v; want one charge and no event", meter.charges, events.events)
	}
}

// A lost event only makes the stats one short; the counted lookup stands.
func TestWordLookupSucceedsWhenTheEventWriteFails(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	events := &fakeLookupEvents{err: errors.New("db locked")}

	qc, _, err := newTestWordLookups(counts, &fakeMeter{}, events).Record(context.Background(), "u1", "w1")

	if err != nil || qc != 1 {
		t.Fatalf("Record = %d, %v; want 1, nil", qc, err)
	}
}
