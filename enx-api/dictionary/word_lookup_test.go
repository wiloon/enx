package dictionary

import (
	"context"
	"errors"
	"testing"
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

// failingMeter fails every charge with err, counting the attempts.
type failingMeter struct {
	err     error
	charged int
}

func (m *failingMeter) Charge(context.Context, string) error {
	m.charged++
	return m.err
}

func TestWordLookupFromCacheChargesTheQuotaAndCounts(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	meter := &fakeMeter{}
	lookups := NewWordLookups(counts, meter)

	qc, known, err := lookups.Record(context.Background(), "u1", "w1", true)

	if err != nil || qc != 1 || known {
		t.Fatalf("Record = %d, %v, %v; want 1, false, nil", qc, known, err)
	}
	if meter.charged != 1 {
		t.Fatalf("charged %d times, want 1", meter.charged)
	}
}

func TestWordLookupNotFromCacheIsNotCharged(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	meter := &fakeMeter{}
	lookups := NewWordLookups(counts, meter)

	qc, _, err := lookups.Record(context.Background(), "u1", "w1", false)

	if err != nil || qc != 1 {
		t.Fatalf("Record = %d, %v; want 1, nil", qc, err)
	}
	if meter.charged != 0 {
		t.Fatalf("charged %d times, want 0: the lookup GET already charged this click", meter.charged)
	}
}

func TestWordLookupFromCacheOverQuotaDoesNotCount(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	meter := &failingMeter{err: ErrQuotaExceeded}
	lookups := NewWordLookups(counts, meter)

	_, _, err := lookups.Record(context.Background(), "u1", "w1", true)

	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("err = %v, want ErrQuotaExceeded", err)
	}
	if n := counts.counts["u1/w1"]; n != 0 {
		t.Fatalf("query count %d, want 0", n)
	}
}

// The extension answers a 404 with a fresh lookup GET, which charges the
// click; charging here too would count it twice.
func TestWordLookupOfAnUnknownWordIsNotFoundAndNotCharged(t *testing.T) {
	counts := newFakeQueryCounts()
	meter := &fakeMeter{}
	lookups := NewWordLookups(counts, meter)

	_, _, err := lookups.Record(context.Background(), "u1", "no-such-word", true)

	if !errors.Is(err, ErrWordNotFound) {
		t.Fatalf("err = %v, want ErrWordNotFound", err)
	}
	if meter.charged != 0 {
		t.Fatalf("charged %d times, want 0", meter.charged)
	}
}

func TestWordLookupWhoseExistenceCheckFailsIsNotCharged(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	counts.existsErr = errors.New("db down")
	meter := &fakeMeter{}
	lookups := NewWordLookups(counts, meter)

	_, _, err := lookups.Record(context.Background(), "u1", "w1", true)

	if err == nil {
		t.Fatal("err = nil, want the existence check's error")
	}
	if meter.charged != 0 {
		t.Fatalf("charged %d times, want 0", meter.charged)
	}
}

// ADR-029 E2: a meter that fails for any reason other than the quota lets
// the lookup through.
func TestWordLookupFromCacheFailsOpenWhenTheMeterErrors(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	meter := &failingMeter{err: errors.New("db down")}
	lookups := NewWordLookups(counts, meter)

	qc, _, err := lookups.Record(context.Background(), "u1", "w1", true)

	if err != nil || qc != 1 {
		t.Fatalf("Record = %d, %v; want 1, nil", qc, err)
	}
}

// The charge stands when the count can't be raised: the same outcome as a
// lost POST after a charged lookup GET (ADR-059 Decision 3).
func TestWordLookupFromCacheStaysChargedWhenTheCountFails(t *testing.T) {
	counts := newFakeQueryCounts("w1")
	counts.recordErr = errors.New("db down")
	meter := &fakeMeter{}
	lookups := NewWordLookups(counts, meter)

	_, _, err := lookups.Record(context.Background(), "u1", "w1", true)

	if err == nil || errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrWordNotFound) {
		t.Fatalf("err = %v, want the record error", err)
	}
	if meter.charged != 1 {
		t.Fatalf("charged %d times, want 1", meter.charged)
	}
}
