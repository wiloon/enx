package dictionary

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakeCandidates is an in-memory CandidateStore (ADR-091).
type fakeCandidates struct {
	rows       map[string]*Candidate // keyed by lower-case english
	hits       []string
	findErr    error
	findCalls  int
	hitErr     error
	addErr     error
	skipAdd    bool
	added      []Candidate
	wordResult *guardedResult // what AddAIWord answers; nil = insert via words
	words      *fakeWords
}

type guardedResult struct {
	id     string
	stored bool
	err    error
}

func newFakeCandidates(words *fakeWords) *fakeCandidates {
	return &fakeCandidates{rows: map[string]*Candidate{}, words: words}
}

func (f *fakeCandidates) seed(c Candidate) { f.rows[strings.ToLower(c.English)] = &c }

func (f *fakeCandidates) FindCandidate(_ context.Context, english string) (Candidate, bool, error) {
	f.findCalls++
	if f.findErr != nil {
		return Candidate{}, false, f.findErr
	}
	c, ok := f.rows[strings.ToLower(english)]
	if !ok {
		return Candidate{}, false, nil
	}
	return *c, true, nil
}

func (f *fakeCandidates) HitCandidate(_ context.Context, english string) error {
	f.hits = append(f.hits, english)
	if f.hitErr != nil {
		return f.hitErr
	}
	if c, ok := f.rows[strings.ToLower(english)]; ok {
		c.HitCount++
	}
	return nil
}

func (f *fakeCandidates) AddCandidate(_ context.Context, c Candidate) (bool, error) {
	if f.addErr != nil {
		return false, f.addErr
	}
	if f.skipAdd {
		return false, nil
	}
	key := strings.ToLower(c.English)
	now := time.Now()
	if existing, ok := f.rows[key]; ok {
		existing.HitCount++
		existing.LastHitAt = now
		return true, nil
	}
	c.FirstHitAt = now
	c.LastHitAt = now
	f.added = append(f.added, c)
	f.rows[key] = &c
	return true, nil
}

func (f *fakeCandidates) AddAIWord(ctx context.Context, e Entry) (string, bool, error) {
	if f.wordResult != nil {
		return f.wordResult.id, f.wordResult.stored, f.wordResult.err
	}
	id, err := f.words.Add(ctx, e)
	return id, true, err
}

type fakeRecorder struct{ outcomes []string }

func (r *fakeRecorder) RecordAIWordOutcome(o string) { r.outcomes = append(r.outcomes, o) }

func newCandidateEnv() (*aiEnv, *fakeCandidates, *fakeRecorder) {
	env := newAIEnv()
	cands := newFakeCandidates(env.words)
	env.svc.UseCandidates(cands)
	return env, cands, env.recorder
}

func TestDefineWithAIKeepsALowQualityDefinitionAsACandidate(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	env.definer.def.Quality = minQuality - 1

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceAI || res.ID != "" || res.Chinese == "" {
		t.Fatalf("got %+v, want the definition shown with no id", res)
	}
	if len(cands.added) != 1 {
		t.Fatalf("candidates = %+v, want one", cands.added)
	}
	c := cands.added[0]
	if c.English != "rizzler" || c.Quality != minQuality-1 || c.PromptVersion != "v1" || c.Status != CandidatePending || c.HitCount != 1 {
		t.Fatalf("candidate = %+v", c)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "candidate_stored" {
		t.Fatalf("outcomes = %v", rec.outcomes)
	}
}

func TestDefineWithAIKeepsADefinitionOverTheCacheWriteLimitAsACandidate(t *testing.T) {
	env, cands, _ := newCandidateEnv()
	env.limiter.denyWrite = true

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "" || len(cands.added) != 1 || len(env.words.added) != 0 {
		t.Fatalf("res=%+v candidates=%v words=%v", res, cands.added, env.words.added)
	}
}

func TestDefineWithAIReturnsThePaidDefinitionWhenCandidateWriteIsSkipped(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	env.definer.def.Quality = minQuality - 1
	cands.skipAdd = true // Another writer stored the word during the model call.

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceAI || res.ID != "" || res.Chinese != goodDefinition.Chinese {
		t.Fatalf("got %+v, want the model's definition with no ID", res)
	}
	if len(env.billing.settled) != 1 {
		t.Fatalf("billed %v, want one charged call", env.billing.settled)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "unstored" {
		t.Fatalf("outcomes = %v, want [unstored]", rec.outcomes)
	}
}

func TestDefineWithAIPendingCandidateHitMakesNoCallAndNoCharge(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	cands.seed(Candidate{English: "rizzler", Chinese: "候选释义", Quality: 5, Status: CandidatePending, HitCount: 1})

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	want := Result{English: "rizzler", Chinese: "候选释义", Source: SourceAI, Origin: OriginAI}
	if res != want {
		t.Fatalf("got %+v, want %+v", res, want)
	}
	if len(env.definer.calls) != 0 || len(env.billing.settled) != 0 || env.limiter.calls != 0 {
		t.Fatalf("calls=%v settled=%v limiter=%d, want none", env.definer.calls, env.billing.settled, env.limiter.calls)
	}
	if cands.rows["rizzler"].HitCount != 2 {
		t.Fatalf("hit count = %d, want 2", cands.rows["rizzler"].HitCount)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "candidate_hit" {
		t.Fatalf("outcomes = %v", rec.outcomes)
	}
}

func TestDefineWithAILowQualityWritePreservesAnInFlightRejection(t *testing.T) {
	env, cands, _ := newCandidateEnv()
	env.definer.def.Quality = minQuality - 1
	env.definer.onCall = func() {
		cands.seed(Candidate{English: "rizzler", Chinese: "旧释义", Status: CandidateRejected, HitCount: 1})
	}

	res, err := env.define("rizzler")
	if err != nil || res.Source != SourceAI || res.ID != "" || res.Chinese != goodDefinition.Chinese {
		t.Fatalf("got %+v, err %v; want the paid definition with no ID", res, err)
	}
	if row := cands.rows["rizzler"]; row.Chinese != "旧释义" || row.HitCount != 2 {
		t.Errorf("conflicting candidate = %+v, want the original definition and two hits", row)
	}

	res, err = env.define("rizzler")
	if err != nil || res.Source != SourceAIMiss || res.Chinese != "" {
		t.Fatalf("later lookup got %+v, err %v; want SourceAIMiss", res, err)
	}
	if len(env.definer.calls) != 1 || len(env.billing.settled) != 1 {
		t.Fatalf("calls = %v, charges = %v; want one call and one charge", env.definer.calls, env.billing.settled)
	}
}

func TestDefineWithAIRejectedCandidateAnswersNoDefinition(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	cands.seed(Candidate{English: "rizzler", Chinese: "x", Status: CandidateRejected, HitCount: 3})

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceAIMiss || res.Chinese != "" {
		t.Fatalf("got %+v, want SourceAIMiss", res)
	}
	if len(env.definer.calls) != 0 || len(env.billing.settled) != 0 {
		t.Fatal("a rejected hit makes no AI call and no charge")
	}
	if cands.rows["rizzler"].HitCount != 4 {
		t.Fatalf("hit count = %d, want 4", cands.rows["rizzler"].HitCount)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "rejected_hit" {
		t.Fatalf("outcomes = %v", rec.outcomes)
	}
}

func TestDefineWithAIStillAnswersWhenTheHitCountFails(t *testing.T) {
	env, cands, _ := newCandidateEnv()
	cands.seed(Candidate{English: "rizzler", Chinese: "候选释义", Status: CandidatePending})
	cands.hitErr = errors.New("busy")

	res, err := env.define("rizzler")
	if err != nil || res.Chinese != "候选释义" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestDefineWithAIStillAnswersWhenTheCandidateInsertFails(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	env.definer.def.Quality = 2
	cands.addErr = errors.New("disk full")

	res, err := env.define("rizzler")
	if err != nil || res.Chinese == "" || res.ID != "" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "unstored" {
		t.Fatalf("outcomes = %v", rec.outcomes)
	}
}

func TestDefineWithAICandidateReadFailureFailsBeforeAnyCall(t *testing.T) {
	env, cands, _ := newCandidateEnv()
	cands.findErr = errors.New("db down")

	if _, err := env.define("rizzler"); err == nil {
		t.Fatal("want the read error")
	}
	if len(env.definer.calls) != 0 || len(env.billing.settled) != 0 {
		t.Fatal("no AI call and no charge after a failed read")
	}
}

func TestDefineWithAIQualifyingWriteRejectedByAdminReturnsNoID(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	cands.wordResult = &guardedResult{stored: false}

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "" || res.Chinese == "" || res.Source != SourceAI {
		t.Fatalf("got %+v, want the definition with no id", res)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "unstored" {
		t.Fatalf("outcomes = %v", rec.outcomes)
	}
}

func TestDefineWithAIQualifyingWriteHittingALiveRowReturnsTheWinnersID(t *testing.T) {
	env, cands, rec := newCandidateEnv()
	cands.wordResult = &guardedResult{id: "winner", stored: true}

	res, err := env.define("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "winner" {
		t.Fatalf("id = %q, want the winning row's id", res.ID)
	}
	if len(rec.outcomes) != 1 || rec.outcomes[0] != "stored" {
		t.Fatalf("outcomes = %v", rec.outcomes)
	}
}

func TestResolveNeverReadsCandidates(t *testing.T) {
	env, cands, _ := newCandidateEnv()
	cands.seed(Candidate{English: "rizzler", Chinese: "x", Status: CandidatePending})
	cands.findErr = errors.New("must not be read")

	res, err := env.svc.Resolve(context.Background(), "rizzler", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceMiss {
		t.Fatalf("got %+v, want a miss", res)
	}
	if cands.findCalls != 0 {
		t.Fatalf("FindCandidate calls = %d, want 0", cands.findCalls)
	}
}
