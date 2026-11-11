package dictionary

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// callLog is the order charges and resolutions happened in.
type callLog []string

// loggedMeter is a fakeMeter that also logs each charge.
type loggedMeter struct {
	fakeMeter
	log *callLog
}

func (m *loggedMeter) Charge(ctx context.Context, userID string, n int) error {
	*m.log = append(*m.log, "charge")
	return m.fakeMeter.Charge(ctx, userID, n)
}

// fakeResolver answers each word from a table; an unknown word is a miss.
type fakeResolver struct {
	results map[string]Result
	errs    map[string]error
	log     *callLog
	asked   []string
}

func (f *fakeResolver) Resolve(_ context.Context, english, _ string) (Result, error) {
	*f.log = append(*f.log, "resolve")
	f.asked = append(f.asked, english)
	if err := f.errs[english]; err != nil {
		return Result{}, err
	}
	if res, ok := f.results[english]; ok {
		return res, nil
	}
	return Result{English: english, Source: SourceMiss}, nil
}

// fakeAIPolicy offers the AI fallback to the users in can, counting asks.
type fakeAIPolicy struct {
	can   map[string]bool
	calls int
}

func (p *fakeAIPolicy) Fallback(_ context.Context, userID string) (bool, bool) {
	p.calls++
	return p.can[userID], false
}

type entriesFixture struct {
	entries  *Entries
	meter    *loggedMeter
	resolver *fakeResolver
	policy   *fakeAIPolicy
	log      *callLog
	lookedUp *fakeLookedUpWords
}

func newEntriesFixture() *entriesFixture {
	log := &callLog{}
	f := &entriesFixture{
		meter:    &loggedMeter{log: log},
		resolver: &fakeResolver{results: map[string]Result{}, errs: map[string]error{}, log: log},
		policy:   &fakeAIPolicy{can: map[string]bool{}},
		log:      log,
		lookedUp: &fakeLookedUpWords{},
	}
	f.entries = NewEntries(f.resolver, f.meter, f.policy, f.lookedUp)
	return f
}

func repeat(word string, n int) []string {
	words := make([]string, n)
	for i := range words {
		words[i] = word
	}
	return words
}

func TestEntriesRejectsAnInvalidBatchBeforeCharging(t *testing.T) {
	for name, words := range map[string][]string{
		"no words":                    {},
		"101 raw entries":             repeat("run", 101),
		"an entry with a space":       {"run", "good morning"},
		"an entry empty once cleaned": {"run", "1234"},
	} {
		t.Run(name, func(t *testing.T) {
			f := newEntriesFixture()

			_, err := f.entries.Lookup(context.Background(), "u1", words)

			if !errors.Is(err, ErrInvalidBatch) {
				t.Fatalf("err = %v, want ErrInvalidBatch", err)
			}
			if len(*f.log) != 0 {
				t.Fatalf("calls %v, want no charge and no resolution", *f.log)
			}
		})
	}
}

// The cap counts raw entries, so 100 duplicates are one batch of one word.
func TestEntriesTakesOneHundredRawEntries(t *testing.T) {
	f := newEntriesFixture()

	results, err := f.entries.Lookup(context.Background(), "u1", repeat("run", 100))

	if err != nil || len(results) != 1 {
		t.Fatalf("got %d results, %v; want 1, nil", len(results), err)
	}
	if !reflect.DeepEqual(f.meter.charges, []int{1}) {
		t.Fatalf("charges %v, want [1]", f.meter.charges)
	}
}

// GET's normalization: case kept, curly apostrophes straightened, the
// possessive and stray punctuation dropped; duplicates are exact matches.
func TestEntriesNormalizesLikeTheLookupGETAndDedupesCaseSensitively(t *testing.T) {
	f := newEntriesFixture()

	results, err := f.entries.Lookup(context.Background(), "u1",
		[]string{"Running", "running", "dog's", "don’t", "don't", "(Running)", "dog"})
	if err != nil {
		t.Fatal(err)
	}

	var keys []string
	for _, r := range results {
		keys = append(keys, r.Word)
	}
	want := []string{"Running", "running", "dog", "don't"}
	if !reflect.DeepEqual(keys, want) || !reflect.DeepEqual(f.resolver.asked, want) {
		t.Fatalf("keys %v, resolved %v; want both %v", keys, f.resolver.asked, want)
	}
	if !reflect.DeepEqual(*f.log, callLog{"charge", "resolve", "resolve", "resolve", "resolve"}) {
		t.Fatalf("calls %v, want one charge of every distinct word before any resolution", *f.log)
	}
	if !reflect.DeepEqual(f.meter.charges, []int{4}) {
		t.Fatalf("charges %v, want [4]", f.meter.charges)
	}
}

func TestEntriesOverQuotaResolvesNothing(t *testing.T) {
	f := newEntriesFixture()
	f.meter.err = ErrQuotaExceeded

	_, err := f.entries.Lookup(context.Background(), "u1", []string{"run", "walk"})

	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("err = %v, want ErrQuotaExceeded", err)
	}
	if len(f.resolver.asked) != 0 {
		t.Fatalf("resolved %v, want nothing", f.resolver.asked)
	}
}

// ADR-029 E2: a meter that fails for any reason but the quota lets the
// batch through.
func TestEntriesFailsOpenWhenTheMeterErrors(t *testing.T) {
	f := newEntriesFixture()
	f.meter.err = errors.New("db down")

	results, err := f.entries.Lookup(context.Background(), "u1", []string{"run"})

	if err != nil || len(results) != 1 {
		t.Fatalf("got %v, %v; want one result", results, err)
	}
}

func TestEntriesReportsFoundMissAndFailedPerWord(t *testing.T) {
	f := newEntriesFixture()
	f.policy.can["u1"] = true
	f.resolver.results["ran"] = Result{ID: "w-run", English: "run", Chinese: "v. 跑", Source: SourceEcdict, Origin: OriginECDICT}
	f.resolver.results["uncached"] = Result{English: "uncached", Chinese: "未缓存", Source: SourceEcdict, Origin: OriginECDICT}
	f.resolver.results["slow"] = Result{English: "slow", Source: SourceTimeout}
	f.resolver.results["broken"] = Result{English: "broken", Source: SourceError}
	f.resolver.errs["offline"] = ErrEcdictUnavailable
	f.resolver.errs["locked"] = errors.New("database is locked")

	results, err := f.entries.Lookup(context.Background(), "u1",
		[]string{"ran", "uncached", "zzxqv", "slow", "broken", "offline", "locked", "qqzzx"})
	if err != nil {
		t.Fatal(err)
	}

	byWord := map[string]EntryResult{}
	for _, r := range results {
		byWord[r.Word] = r
	}
	if r := byWord["ran"]; r.Status != EntryFound || r.Result.English != "run" || r.Result.ID != "w-run" || r.AIFallback != nil {
		t.Errorf("ran = %+v, want found under ran with headword run", r)
	}
	if r := byWord["uncached"]; r.Status != EntryFound || r.Result.ID != "" || r.Result.Chinese != "未缓存" {
		t.Errorf("uncached = %+v, want found without an id", r)
	}
	for _, miss := range []string{"zzxqv", "qqzzx"} {
		if r := byWord[miss]; r.Status != EntryNotFound || r.AIFallback == nil || !r.AIFallback.CanUse {
			t.Errorf("%s = %+v, want not_found with the user's AI fallback", miss, r)
		}
	}
	for _, failed := range []string{"slow", "broken", "offline", "locked"} {
		if r := byWord[failed]; r.Status != EntryFailed || r.AIFallback != nil || r.Result.Chinese != "" {
			t.Errorf("%s = %+v, want failed with no AI fallback", failed, r)
		}
	}
	if f.policy.calls != 1 {
		t.Fatalf("AI policy asked %d times, want once per request", f.policy.calls)
	}
}

func TestEntriesAsksTheAIPolicyOnlyForAMiss(t *testing.T) {
	f := newEntriesFixture()
	f.resolver.results["run"] = Result{ID: "w1", English: "run", Source: SourceLocal, Origin: OriginECDICT}

	if _, err := f.entries.Lookup(context.Background(), "u1", []string{"run"}); err != nil {
		t.Fatal(err)
	}
	if f.policy.calls != 0 {
		t.Fatalf("AI policy asked %d times, want 0", f.policy.calls)
	}
}

func TestEntriesAIFallbackFollowsTheUser(t *testing.T) {
	f := newEntriesFixture()
	f.policy.can["paid"] = true

	paid, _ := f.entries.Lookup(context.Background(), "paid", []string{"zzxqv"})
	free, _ := f.entries.Lookup(context.Background(), "free", []string{"zzxqv"})

	if !paid[0].AIFallback.CanUse || free[0].AIFallback.CanUse {
		t.Fatalf("paid %+v, free %+v; want the fallback offered to paid only", paid[0].AIFallback, free[0].AIFallback)
	}
}

// Without ECDICT, words in the words table still come back; the rest fail
// rather than pass for misses.
func TestEntriesReturnsLocalHitsWhenECDICTIsUnavailable(t *testing.T) {
	svc, words, external := newTestService()
	external.unavailable = true
	words.seed("w1", Entry{English: "serendipity", Chinese: "机缘巧合"})
	entries := NewEntries(svc, &fakeMeter{}, &fakeAIPolicy{}, &fakeLookedUpWords{})

	results, err := entries.Lookup(context.Background(), "u1", []string{"serendipity", "run"})
	if err != nil {
		t.Fatal(err)
	}

	if results[0].Status != EntryFound || results[0].Result.ID != "w1" || !strings.Contains(results[0].Result.Chinese, "机缘") {
		t.Errorf("serendipity = %+v, want found", results[0])
	}
	if results[1].Status != EntryFailed {
		t.Errorf("run = %+v, want failed", results[1])
	}
}

// Before the AI fallback is set up there is no policy, and a miss offers
// nothing.
func TestEntriesWithoutAPolicyOffersNoAIFallback(t *testing.T) {
	log := &callLog{}
	entries := NewEntries(&fakeResolver{log: log}, &fakeMeter{}, nil, &fakeLookedUpWords{})

	results, err := entries.Lookup(context.Background(), "u1", []string{"zzxqv"})

	if err != nil || results[0].Status != EntryNotFound || results[0].AIFallback != nil {
		t.Fatalf("got %+v, %v; want not_found without an AI fallback", results, err)
	}
}

type fakeLookedUpWords struct {
	calls     int
	userID    string
	requested []string
	words     []string
	err       error
}

func (f *fakeLookedUpWords) LookedUpWords(_ context.Context, userID string, words []string) ([]string, error) {
	f.requested = append([]string(nil), words...)
	f.calls++
	f.userID = userID
	return f.words, f.err
}

func TestEntriesLookedUpWordsAreFreeEvenOverQuota(t *testing.T) {
	f := newEntriesFixture()
	f.meter.err = ErrQuotaExceeded
	*f.lookedUp = fakeLookedUpWords{words: []string{"run", "hello"}}
	f.resolver.results["run"] = Result{English: "run", Source: SourceLocal}
	f.resolver.results["hello"] = Result{English: "hello", Source: SourceLocal}
	results, err := f.entries.Lookup(context.Background(), "u1", []string{"run", "hello"})
	if err != nil || len(results) != 2 {
		t.Fatalf("results %v, err %v; want both definitions even over quota", results, err)
	}
	for _, result := range results {
		if result.Status != EntryFound {
			t.Fatalf("result %+v, want found", result)
		}
	}
	if len(f.meter.charges) != 0 {
		t.Fatalf("charges %v, want no meter call", f.meter.charges)
	}
}

func TestEntriesMixedBatchChargesOnlyDistinctNewWordsCaseInsensitively(t *testing.T) {
	f := newEntriesFixture()
	*f.lookedUp = fakeLookedUpWords{words: []string{"Run", "hello"}}
	results, err := f.entries.Lookup(context.Background(), "u1", []string{"run", "RUN", "hello", "walk", "(walk)", "new"})
	if err != nil || len(results) != 5 {
		t.Fatalf("results %v, err %v; want five normalized distinct results", results, err)
	}
	if !reflect.DeepEqual(f.meter.charges, []int{2}) {
		t.Fatalf("charges %v, want [2]", f.meter.charges)
	}
	if f.lookedUp.calls != 1 || f.lookedUp.userID != "u1" {
		t.Fatalf("looked-up reads %d for %q, want once for u1", f.lookedUp.calls, f.lookedUp.userID)
	}
}

func TestEntriesLookedUpWordsReadErrorChargesTheWholeBatch(t *testing.T) {
	f := newEntriesFixture()
	*f.lookedUp = fakeLookedUpWords{words: []string{"run"}, err: errors.New("read failed")}
	_, err := f.entries.Lookup(context.Background(), "u1", []string{"run", "walk", "run"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.meter.charges, []int{2}) {
		t.Fatalf("charges %v, want [2]", f.meter.charges)
	}
	if f.lookedUp.calls != 1 || f.lookedUp.userID != "u1" {
		t.Fatalf("looked-up reads %d for %q, want once for u1", f.lookedUp.calls, f.lookedUp.userID)
	}
}

func TestEntriesWordsAbsentFromLookedUpWordsAreCharged(t *testing.T) {
	for _, word := range []string{"never-looked-up", "deleted", "other-users-word"} {
		t.Run(word, func(t *testing.T) {
			f := newEntriesFixture()
			_, err := f.entries.Lookup(context.Background(), "u1", []string{word})
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(f.meter.charges, []int{1}) {
				t.Fatalf("charges %v, want [1]", f.meter.charges)
			}
		})
	}
}

func TestEntriesReadsOnlyNormalizedDistinctBatchWords(t *testing.T) {
	f := newEntriesFixture()
	_, err := f.entries.Lookup(context.Background(), "u1", []string{"(run)", "hello", "run"})
	if err != nil {
		t.Fatal(err)
	}
	if f.lookedUp.calls != 1 || f.lookedUp.userID != "u1" || !reflect.DeepEqual(f.lookedUp.requested, []string{"run", "hello"}) {
		t.Fatalf("looked-up reads %d for %q with %v, want once for u1 with [run hello]", f.lookedUp.calls, f.lookedUp.userID, f.lookedUp.requested)
	}
	if !reflect.DeepEqual(f.meter.charges, []int{2}) {
		t.Fatalf("charges %v, want [2]", f.meter.charges)
	}
}
