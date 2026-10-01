package dictionary

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeWords is an in-memory WordStore keyed like the words table: exact
// match first, then case-insensitive.
type fakeWords struct {
	rows    map[string]Entry // id -> entry
	added   []Entry
	findErr error
	addErr  error
}

func newFakeWords() *fakeWords { return &fakeWords{rows: map[string]Entry{}} }

func (f *fakeWords) seed(id string, e Entry) { f.rows[id] = e }

func (f *fakeWords) Find(_ context.Context, english string) (string, Entry, bool, error) {
	if f.findErr != nil {
		return "", Entry{}, false, f.findErr
	}
	for id, e := range f.rows {
		if e.English == english {
			return id, e, true, nil
		}
	}
	for id, e := range f.rows {
		if strings.EqualFold(e.English, english) {
			return id, e, true, nil
		}
	}
	return "", Entry{}, false, nil
}

func (f *fakeWords) Add(_ context.Context, e Entry) (string, error) {
	if f.addErr != nil {
		return "", f.addErr
	}
	f.added = append(f.added, e)
	for id, row := range f.rows {
		if row.English == e.English {
			return id, nil
		}
	}
	id := "id-" + e.English
	f.rows[id] = e
	return id, nil
}

// fakeExternal is an in-memory ExternalDictionary; forms maps an inflection
// to its headword, the way ECDICT's exchange column does.
type fakeExternal struct {
	unavailable bool
	entries     map[string]Entry
	forms       map[string]string
	err         error // returned instead of looking anything up
	queried     []string
}

func (f *fakeExternal) Available() bool { return !f.unavailable }

func (f *fakeExternal) Lookup(_ context.Context, english string) (Entry, error) {
	f.queried = append(f.queried, english)
	if f.err != nil {
		return Entry{}, f.err
	}
	if head, ok := f.forms[english]; ok {
		english = head
	}
	e, ok := f.entries[english]
	if !ok {
		return Entry{}, ErrNotInDictionary
	}
	return e, nil
}

// fakeMeter counts charges and rejects once limit is reached (0 = no limit).
type fakeMeter struct {
	limit   int
	charged int
}

func (m *fakeMeter) Charge(context.Context, string) error {
	m.charged++
	if m.limit > 0 && m.charged > m.limit {
		return ErrQuotaExceeded
	}
	return nil
}

var run = Entry{English: "run", Chinese: "v. 跑", Pronunciation: "rʌn"}

func newTestService() (*Service, *fakeWords, *fakeExternal, *fakeMeter) {
	words := newFakeWords()
	external := &fakeExternal{
		entries: map[string]Entry{"run": run},
		forms:   map[string]string{"ran": "run"},
	}
	meter := &fakeMeter{}
	return NewService(words, external, meter), words, external, meter
}

func TestResolveLocalHit(t *testing.T) {
	svc, words, external, meter := newTestService()
	words.seed("w1", Entry{English: "serendipity", Chinese: "机缘巧合"})

	res, err := svc.Resolve(context.Background(), "serendipity", "u1")
	if err != nil {
		t.Fatal(err)
	}
	want := Result{ID: "w1", English: "serendipity", Chinese: "机缘巧合", Source: SourceLocal}
	if res != want {
		t.Fatalf("got %+v, want %+v", res, want)
	}
	if meter.charged != 1 || len(external.queried) != 0 {
		t.Fatalf("charged=%d external queries=%v, want 1 charge and no external query", meter.charged, external.queried)
	}
}

// The response keeps the word as the user typed it; the cached row matched
// case-insensitively.
func TestResolveLocalHitKeepsTypedEnglish(t *testing.T) {
	svc, words, _, _ := newTestService()
	words.seed("w1", Entry{English: "serendipity", Chinese: "机缘巧合"})

	res, err := svc.Resolve(context.Background(), "Serendipity", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "w1" || res.English != "Serendipity" {
		t.Fatalf("got %+v, want row w1 with English as typed", res)
	}
}

// A cached word needs no external dictionary, so it resolves even when that
// dictionary is down.
func TestResolveLocalHitWithoutExternalDictionary(t *testing.T) {
	svc, words, external, _ := newTestService()
	external.unavailable = true
	words.seed("w1", Entry{English: "serendipity"})

	res, err := svc.Resolve(context.Background(), "serendipity", "u1")
	if err != nil || res.Source != SourceLocal {
		t.Fatalf("got %+v, %v; want a local hit", res, err)
	}
}

// ADR-018 B2: a local hit counts against the daily quota like any lookup.
func TestResolveMetersLocalHit(t *testing.T) {
	svc, words, _, meter := newTestService()
	meter.limit = 1
	words.seed("w1", Entry{English: "serendipity"})
	ctx := context.Background()

	if _, err := svc.Resolve(ctx, "serendipity", "u1"); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	if _, err := svc.Resolve(ctx, "serendipity", "u1"); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("lookup 2: got %v, want ErrQuotaExceeded", err)
	}
}

func TestResolveExternalHitIsCached(t *testing.T) {
	svc, words, _, meter := newTestService()

	res, err := svc.Resolve(context.Background(), "run", "u1")
	if err != nil {
		t.Fatal(err)
	}
	want := Result{ID: "id-run", English: "run", Chinese: "v. 跑", Pronunciation: "rʌn", Source: SourceEcdict}
	if res != want {
		t.Fatalf("got %+v, want %+v", res, want)
	}
	if len(words.added) != 1 || words.added[0] != run || meter.charged != 1 {
		t.Fatalf("added=%v charged=%d, want run cached once and one charge", words.added, meter.charged)
	}

	again, err := svc.Resolve(context.Background(), "run", "u1")
	if err != nil || again.Source != SourceLocal || again.ID != "id-run" {
		t.Fatalf("second lookup: got %+v, %v; want a local hit on id-run", again, err)
	}
}

// An inflection resolves to its headword; when the headword is already
// cached, its row is reused.
func TestResolveInflectionReusesCachedHeadword(t *testing.T) {
	svc, words, _, _ := newTestService()
	words.seed("w-run", run)

	res, err := svc.Resolve(context.Background(), "ran", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceEcdict || res.ID != "w-run" || res.English != "run" {
		t.Fatalf("got %+v, want headword run on row w-run", res)
	}
	if len(words.rows) != 1 {
		t.Fatalf("words rows: got %d, want 1", len(words.rows))
	}
}

func TestResolveMiss(t *testing.T) {
	svc, words, _, meter := newTestService()

	res, err := svc.Resolve(context.Background(), "zzxqv", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res != (Result{English: "zzxqv", Source: SourceMiss}) {
		t.Fatalf("got %+v, want a miss", res)
	}
	if len(words.added) != 0 || meter.charged != 1 {
		t.Fatalf("added=%v charged=%d, want nothing cached and one charge", words.added, meter.charged)
	}
}

// Not cached and no external dictionary: unavailable, and not charged.
func TestResolveUncachedWordWithoutExternalDictionary(t *testing.T) {
	svc, _, external, meter := newTestService()
	external.unavailable = true

	if _, err := svc.Resolve(context.Background(), "run", "u1"); !errors.Is(err, ErrEcdictUnavailable) {
		t.Fatalf("got %v, want ErrEcdictUnavailable", err)
	}
	if meter.charged != 0 {
		t.Fatalf("charged=%d, want 0", meter.charged)
	}
}

// Over quota: the external dictionary is never queried.
func TestResolveQuotaExceededSkipsExternalLookup(t *testing.T) {
	svc, _, external, meter := newTestService()
	meter.limit, meter.charged = 1, 1 // the quota is already used up

	if _, err := svc.Resolve(context.Background(), "run", "u1"); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("got %v, want ErrQuotaExceeded", err)
	}
	if len(external.queried) != 0 {
		t.Fatalf("external queried %v, want none", external.queried)
	}
}

// Failing to cache still answers with the definition, without a row id.
func TestResolveAnswersWhenCachingFails(t *testing.T) {
	svc, words, _, _ := newTestService()
	words.addErr = errors.New("disk full")

	res, err := svc.Resolve(context.Background(), "run", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "" || res.Chinese != "v. 跑" || res.Source != SourceEcdict {
		t.Fatalf("got %+v, want the definition with no id", res)
	}
}

func TestResolveReturnsWordStoreErrors(t *testing.T) {
	svc, words, _, _ := newTestService()
	words.findErr = errors.New("db down")

	if _, err := svc.Resolve(context.Background(), "run", "u1"); err == nil || err.Error() != "db down" {
		t.Fatalf("got %v, want the store's error", err)
	}
}

// The external dictionary failing to answer is not a miss: it is labelled
// timeout or error, so the miss rate measures dictionary coverage only. The
// user still gets a no-definition answer, and nothing is cached.
func TestResolveLabelsExternalFailures(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want Source
	}{
		{ErrExternalTimeout, SourceTimeout},
		{errors.New("disk I/O error"), SourceError},
		{context.Canceled, SourceError},
	} {
		svc, words, external, _ := newTestService()
		external.err = tc.err

		res, err := svc.Resolve(context.Background(), "run", "u1")
		if err != nil {
			t.Fatalf("%v: Resolve returned %v, want a result", tc.err, err)
		}
		if res != (Result{English: "run", Source: tc.want}) {
			t.Errorf("%v: got %+v, want source %q and no definition", tc.err, res, tc.want)
		}
		if len(words.added) != 0 {
			t.Errorf("%v: cached %v", tc.err, words.added)
		}
	}
}
