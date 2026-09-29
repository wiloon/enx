package enx

import (
	"context"
	"errors"
	"testing"
)

type fakeWordStates struct {
	states []WordState
	err    error
	calls  [][]string
}

func (f *fakeWordStates) FindByEnglish(_ context.Context, _ string, englishes []string) ([]WordState, error) {
	f.calls = append(f.calls, englishes)
	return f.states, f.err
}

// A paragraph costs one lookup, each distinct word appears in it once, and
// tokens that are never looked up (digits, pure punctuation) stay out of it.
func TestTextWordsLooksUpEachWordOnceInOneCall(t *testing.T) {
	store := &fakeWordStates{states: []WordState{{ID: "w1", English: "run", QueryCount: 2}}}

	words, err := NewTextWords(store).In(context.Background(), "run Run run, 3rd —— walk", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(store.calls) != 1 {
		t.Fatalf("store called %d times, want 1", len(store.calls))
	}
	got := map[string]bool{}
	for _, e := range store.calls[0] {
		if got[e] {
			t.Fatalf("%q looked up twice in %q", e, store.calls[0])
		}
		got[e] = true
	}
	if !got["run"] || !got["Run"] || !got["walk"] || len(got) != 3 {
		t.Fatalf("looked up %q, want run, Run and walk", store.calls[0])
	}
	if words["Run"].Id != "w1" || words["Run"].LoadCount != 2 {
		t.Fatalf("Run = %+v, want the case-insensitive match w1", words["Run"])
	}
}

func TestTextWordsSkipsTheStoreWhenNothingToLookUp(t *testing.T) {
	store := &fakeWordStates{}

	if _, err := NewTextWords(store).In(context.Background(), "42 —— 7th", "u1"); err != nil {
		t.Fatal(err)
	}
	if len(store.calls) != 0 {
		t.Fatalf("store called %d times, want 0", len(store.calls))
	}
}

func TestTextWordsReturnsStoreErrors(t *testing.T) {
	store := &fakeWordStates{err: errors.New("db down")}

	if _, err := NewTextWords(store).In(context.Background(), "run", "u1"); err == nil {
		t.Fatal("want the store's error")
	}
}
