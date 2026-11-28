package dictionary

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type fakeEnglishDefiner struct {
	def   EnglishModelDefinition
	usage AIUsage
	err   error
	calls []string
}

func (f *fakeEnglishDefiner) DefineEnglishWord(_ context.Context, word string) (EnglishModelDefinition, AIUsage, error) {
	f.calls = append(f.calls, word)
	return f.def, f.usage, f.err
}

func newEnglishAIEnv() *aiEnv {
	ent := &fakeEntitlements{can: true}
	svc, words, external, _ := newEnglishService(nil)
	svc.ent = ent
	env := &aiEnv{
		svc: svc, words: words, external: external, ent: ent,
		definer:  &fakeDefiner{def: goodDefinition, usage: AIUsage{PromptTokens: 150, CompletionTokens: 40}},
		billing:  &fakeBilling{balance: 10},
		limiter:  &fakeLimiter{},
		recorder: &fakeRecorder{},
	}
	svc.EnableAI(env.definer, env.billing, env.limiter, AIConfig{MinQuality: minQuality, PromptVersion: "v1"})
	svc.RecordAIWordOutcomes(env.recorder)
	svc.EnableEnglishAI(&fakeEnglishDefiner{
		def: EnglishModelDefinition{
			IsWord: true, Quality: 5,
			Senses: []Sense{{POS: "noun", Gloss: "A stylish person.", Example: "He is a rizzler."}},
		},
		usage: AIUsage{PromptTokens: 150, CompletionTokens: 40},
	}, "en-v1")
	svc.UseEnglishAI(&fakeEnglishAI{})
	return env
}

func (e *aiEnv) englishDefiner() *fakeEnglishDefiner {
	return e.svc.ai.englishDefiner.(*fakeEnglishDefiner)
}

func (e *aiEnv) englishAI() *fakeEnglishAI {
	return e.svc.englishAI.(*fakeEnglishAI)
}

func (e *aiEnv) defineEnglish(word string) (Result, error) {
	return e.svc.DefineWithAI(context.Background(), word, "u1", LanguageEnglish)
}

func TestDefineWithAIInEnglishStoresRegardlessOfQualityAndWriteLimit(t *testing.T) {
	env := newEnglishAIEnv()
	env.limiter.denyWrite = true
	env.englishDefiner().def.Quality = 1

	res, err := env.defineEnglish("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	want := Result{
		ID: "id-rizzler", English: "rizzler", Source: SourceAI, Origin: OriginAI,
		Definition: &EnglishDefinition{Senses: []Sense{
			{POS: "noun", Gloss: "A stylish person.", Example: "He is a rizzler."},
		}},
	}
	if !reflect.DeepEqual(res, want) {
		t.Fatalf("got %+v, want %+v", res, want)
	}
	if len(env.englishDefiner().calls) != 1 {
		t.Fatalf("model calls = %v", env.englishDefiner().calls)
	}
	if len(env.englishAI().inserts) != 1 || env.englishAI().inserts[0].Quality != 1 {
		t.Fatalf("inserts = %+v", env.englishAI().inserts)
	}
	if env.limiter.writes != 0 {
		t.Fatalf("cache write checks = %d, want 0 for en", env.limiter.writes)
	}
	if res.Chinese != "" {
		t.Fatalf("Chinese = %q, want empty", res.Chinese)
	}
	assertAIWordOutcome(t, env.recorder, outcomeStored)
}

func TestDefineWithAIInEnglishStillCallsTheModelWhenECDICTKnowsTheWord(t *testing.T) {
	env := newEnglishAIEnv()
	env.external.entries["rizzler"] = Entry{English: "rizzler", Chinese: "n. 很有魅力的人"}

	res, err := env.defineEnglish("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceAI || res.Origin != OriginAI || res.Chinese != "" {
		t.Fatalf("got %+v, want an English AI definition", res)
	}
	if len(env.englishDefiner().calls) != 1 {
		t.Fatalf("model calls = %v", env.englishDefiner().calls)
	}
}

func TestDefineWithAIInEnglishReturnsAWiktionaryHitAsKnown(t *testing.T) {
	env := newEnglishAIEnv()
	wiktionary := env.svc.wiktionary.(*fakeWiktionary)
	wiktionary.keys = map[string]WiktionaryRecords{
		"run": {Entries: []WiktionaryEntry{entry("verb", "To move quickly.")}},
	}

	res, err := env.defineEnglish("run")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceWiktionary || res.Origin != OriginWiktionary {
		t.Fatalf("got %+v", res)
	}
	if len(env.englishDefiner().calls) != 0 || len(env.billing.settled) != 0 {
		t.Fatalf("model/billing ran: calls=%v settled=%v", env.englishDefiner().calls, env.billing.settled)
	}
	assertAIWordOutcome(t, env.recorder, outcomeKnown)
}

func TestDefineWithAIInEnglishReturnsAStoredRowAsKnown(t *testing.T) {
	env := newEnglishAIEnv()
	env.words.seed("w1", Entry{English: "rizzler", Chinese: "n. 人", Origin: OriginECDICT})
	env.englishAI().rows = map[string]EnglishAIRow{
		"w1": {WordID: "w1", Senses: []Sense{{POS: "noun", Gloss: "Stored.", Example: "Stored."}}},
	}

	res, err := env.defineEnglish("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceLocal || res.Origin != OriginAI || res.Definition.Senses[0].Gloss != "Stored." {
		t.Fatalf("got %+v", res)
	}
	if len(env.englishDefiner().calls) != 0 {
		t.Fatalf("model was called")
	}
	assertAIWordOutcome(t, env.recorder, outcomeKnown)
}

func TestDefineWithAIInEnglishRefusesAnIneligibleUser(t *testing.T) {
	env := newEnglishAIEnv()
	env.ent.can = false
	_, err := env.defineEnglish("rizzler")
	if !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("err = %v", err)
	}
	if len(env.englishDefiner().calls) != 0 {
		t.Fatal("model was called")
	}
}

func TestDefineWithAIInEnglishNotAWordCreatesNoRow(t *testing.T) {
	env := newEnglishAIEnv()
	env.englishDefiner().def = EnglishModelDefinition{IsWord: false}

	res, err := env.defineEnglish("asdfgh")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceAIMiss || len(env.englishAI().inserts) != 0 || len(env.words.added) != 0 {
		t.Fatalf("got %+v inserts=%d added=%d", res, len(env.englishAI().inserts), len(env.words.added))
	}
	assertAIWordOutcome(t, env.recorder, outcomeNotAWord)
}

func TestDefineWithAIInEnglishMakesNoCallWhenWiktionaryIsUnavailable(t *testing.T) {
	env := newEnglishAIEnv()
	env.svc.wiktionary.(*fakeWiktionary).unavailable = true

	_, err := env.defineEnglish("rizzler")
	if !errors.Is(err, ErrWiktionaryUnavailable) {
		t.Fatalf("err = %v", err)
	}
	if len(env.englishDefiner().calls) != 0 {
		t.Fatal("model was called")
	}
}

func TestDefineWithAIInEnglishMakesNoCallOnAWiktionaryReadFailure(t *testing.T) {
	env := newEnglishAIEnv()
	env.svc.wiktionary.(*fakeWiktionary).err = errors.New("db down")

	_, err := env.defineEnglish("rizzler")
	if !errors.Is(err, ErrDictionaryFailed) {
		t.Fatalf("err = %v", err)
	}
	if len(env.englishDefiner().calls) != 0 {
		t.Fatal("model was called")
	}
}

func TestDefineWithAIInEnglishMakesNoCallOnAWordsReadFailure(t *testing.T) {
	env := newEnglishAIEnv()
	env.words.seed("w1", Entry{English: "rizzler", Origin: OriginECDICT})
	env.words.idErr = errors.New("db down")

	_, err := env.defineEnglish("rizzler")
	if !errors.Is(err, ErrDictionaryFailed) {
		t.Fatalf("err = %v", err)
	}
	if len(env.englishDefiner().calls) != 0 || len(env.billing.settled) != 0 {
		t.Fatalf("model/billing ran: calls=%v settled=%v", env.englishDefiner().calls, env.billing.settled)
	}
}

func TestDefineWithAIInEnglishAnswersWithIDWhenOnlyTheTableInsertFails(t *testing.T) {
	env := newEnglishAIEnv()
	env.englishAI().insertErr = errors.New("write failed")

	res, err := env.defineEnglish("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	want := Result{
		ID: "id-rizzler", English: "rizzler", Source: SourceAI, Origin: OriginAI,
		Definition: &EnglishDefinition{Senses: []Sense{
			{POS: "noun", Gloss: "A stylish person.", Example: "He is a rizzler."},
		}},
	}
	if !reflect.DeepEqual(res, want) {
		t.Fatalf("got %+v, want %+v", res, want)
	}
	assertAIWordOutcome(t, env.recorder, outcomeUnstored)
}

// conflictEnglishAI misses on the re-check Find, then on Insert reports a
// conflict and surfaces the winner's row (concurrent misses of one word).
type conflictEnglishAI struct {
	winner   EnglishAIRow
	inserted bool
}

func (c *conflictEnglishAI) Find(_ context.Context, wordID string) (EnglishAIRow, bool, error) {
	if !c.inserted || c.winner.WordID != wordID {
		return EnglishAIRow{}, false, nil
	}
	return c.winner, true, nil
}

func (c *conflictEnglishAI) Insert(context.Context, EnglishAIRow) (bool, error) {
	c.inserted = true
	return false, nil
}

func TestDefineWithAIInEnglishInsertConflictReturnsTheStoredRow(t *testing.T) {
	env := newEnglishAIEnv()
	env.words.seed("id-rizzler", Entry{English: "rizzler", Origin: OriginWiktionary})
	env.svc.UseEnglishAI(&conflictEnglishAI{
		winner: EnglishAIRow{WordID: "id-rizzler", Senses: []Sense{{POS: "noun", Gloss: "First.", Example: "First."}}},
	})

	res, err := env.defineEnglish("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.Definition.Senses[0].Gloss != "First." || res.ID != "id-rizzler" {
		t.Fatalf("got %+v", res)
	}
	assertAIWordOutcome(t, env.recorder, outcomeStored)
}

func TestDefineWithAIInEnglishAnswersWithoutIDWhenNoWordsRowCanBeCreated(t *testing.T) {
	env := newEnglishAIEnv()
	env.words.addErr = errors.New("write failed")
	env.external.unavailable = true

	res, err := env.defineEnglish("rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "" || res.Source != SourceAI || len(env.englishAI().inserts) != 0 {
		t.Fatalf("got %+v inserts=%d", res, len(env.englishAI().inserts))
	}
	assertAIWordOutcome(t, env.recorder, outcomeUnstored)
}

func TestDefineWithAIInChineseIsUnchanged(t *testing.T) {
	env := newAIEnv()
	res, err := env.svc.DefineWithAI(context.Background(), "rizzler", "u1", LanguageZhHans)
	if err != nil {
		t.Fatal(err)
	}
	if res.Chinese != "n. 很有魅力的人" || res.Source != SourceAI {
		t.Fatalf("got %+v", res)
	}
}
