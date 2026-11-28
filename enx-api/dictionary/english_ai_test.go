package dictionary

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type fakeEnglishAI struct {
	rows    map[string]EnglishAIRow
	findErr error
	inserts []EnglishAIRow
}

func (f *fakeEnglishAI) Find(_ context.Context, wordID string) (EnglishAIRow, bool, error) {
	if f.findErr != nil {
		return EnglishAIRow{}, false, f.findErr
	}
	row, ok := f.rows[wordID]
	return row, ok, nil
}

func (f *fakeEnglishAI) Insert(_ context.Context, row EnglishAIRow) (bool, error) {
	f.inserts = append(f.inserts, row)
	if f.rows == nil {
		f.rows = map[string]EnglishAIRow{}
	}
	if _, ok := f.rows[row.WordID]; ok {
		return false, nil
	}
	f.rows[row.WordID] = row
	return true, nil
}

func TestResolveInEnglishServesAStoredAIRowToAnEligibleUser(t *testing.T) {
	svc, words, _, _ := newEnglishService(nil)
	words.seed("w1", Entry{English: "rizzler", Chinese: "n. 很有魅力的人", Origin: OriginECDICT})
	ai := &fakeEnglishAI{rows: map[string]EnglishAIRow{
		"w1": {WordID: "w1", Quality: 5, PromptVersion: "v1", Senses: []Sense{
			{POS: "noun", Gloss: "A stylish person.", Example: "He is a rizzler."},
		}},
	}}
	svc.UseEnglishAI(ai)
	svc.ent = &fakeEntitlements{can: true}

	res := resolveEnglish(t, svc, "rizzler")
	want := Result{
		ID: "w1", English: "rizzler", Source: SourceLocal, Origin: OriginAI,
		Definition: &EnglishDefinition{Senses: []Sense{
			{POS: "noun", Gloss: "A stylish person.", Example: "He is a rizzler."},
		}},
	}
	if !reflect.DeepEqual(res, want) {
		t.Fatalf("got %+v, want %+v", res, want)
	}
}

func TestResolveInEnglishHidesAStoredAIRowFromAnIneligibleUser(t *testing.T) {
	svc, words, _, _ := newEnglishService(nil)
	words.seed("w1", Entry{English: "rizzler", Origin: OriginECDICT})
	svc.UseEnglishAI(&fakeEnglishAI{rows: map[string]EnglishAIRow{
		"w1": {WordID: "w1", Senses: []Sense{{POS: "noun", Gloss: "A stylish person.", Example: "He is."}}},
	}})
	svc.ent = &fakeEntitlements{can: false}

	res := resolveEnglish(t, svc, "rizzler")
	if res.Source != SourceMiss || res.Definition != nil {
		t.Fatalf("got %+v, want a miss", res)
	}
}

func TestResolveInEnglishHidesAStoredAIRowFromNoUser(t *testing.T) {
	svc, words, _, _ := newEnglishService(nil)
	words.seed("w1", Entry{English: "rizzler", Origin: OriginECDICT})
	svc.UseEnglishAI(&fakeEnglishAI{rows: map[string]EnglishAIRow{
		"w1": {WordID: "w1", Senses: []Sense{{POS: "noun", Gloss: "A stylish person.", Example: "He is."}}},
	}})
	svc.ent = &fakeEntitlements{can: true}

	res, err := svc.Resolve(context.Background(), "rizzler", NoUser, LanguageEnglish)
	if err != nil || res.Source != SourceMiss {
		t.Fatalf("got %+v, %v; want a miss", res, err)
	}
}

func TestResolveInEnglishHidesAStoredAIRowWhenEntitlementErrors(t *testing.T) {
	svc, words, _, _ := newEnglishService(nil)
	words.seed("w1", Entry{English: "rizzler", Origin: OriginECDICT})
	svc.UseEnglishAI(&fakeEnglishAI{rows: map[string]EnglishAIRow{
		"w1": {WordID: "w1", Senses: []Sense{{POS: "noun", Gloss: "A stylish person.", Example: "He is."}}},
	}})
	svc.ent = &fakeEntitlements{err: errors.New("entitlement down")}

	res := resolveEnglish(t, svc, "rizzler")
	if res.Source != SourceMiss {
		t.Fatalf("got %+v, want a miss", res)
	}
}

func TestResolveInEnglishReportsAnAITableReadFailureAsSourceError(t *testing.T) {
	svc, words, _, _ := newEnglishService(nil)
	words.seed("w1", Entry{English: "rizzler", Origin: OriginECDICT})
	svc.UseEnglishAI(&fakeEnglishAI{findErr: errors.New("db down")})
	svc.ent = &fakeEntitlements{can: true}

	res := resolveEnglish(t, svc, "rizzler")
	if res.Source != SourceError {
		t.Fatalf("got %+v, want SourceError", res)
	}
}

func TestResolveInEnglishFindsTheAIRowViaECDICTSpelling(t *testing.T) {
	svc, words, external, _ := newEnglishService(nil)
	external.forms = map[string]string{"us": "U.S."}
	external.entries = map[string]Entry{"U.S.": {English: "U.S.", Chinese: "美国"}}
	words.seed("w-us", Entry{English: "U.S.", Chinese: "美国", Origin: OriginECDICT})
	svc.UseEnglishAI(&fakeEnglishAI{rows: map[string]EnglishAIRow{
		"w-us": {WordID: "w-us", Senses: []Sense{{POS: "name", Gloss: "The United States.", Example: "I live in the U.S."}}},
	}})
	svc.ent = &fakeEntitlements{can: true}

	res := resolveEnglish(t, svc, "us")
	if res.Source != SourceLocal || res.Origin != OriginAI || res.ID != "w-us" {
		t.Fatalf("got %+v", res)
	}
}

func TestResolveInEnglishPrefersWiktionaryOverAStoredAIRow(t *testing.T) {
	svc, words, _, _ := newEnglishService(map[string]WiktionaryRecords{
		"run": {Entries: []WiktionaryEntry{entry("verb", "To move quickly.")}},
	})
	words.seed("w1", Entry{English: "run", Chinese: "跑", Origin: OriginECDICT})
	svc.UseEnglishAI(&fakeEnglishAI{rows: map[string]EnglishAIRow{
		"w1": {WordID: "w1", Senses: []Sense{{POS: "verb", Gloss: "AI gloss.", Example: "Run."}}},
	}})
	svc.ent = &fakeEntitlements{can: true}

	res := resolveEnglish(t, svc, "run")
	if res.Source != SourceWiktionary || res.Origin != OriginWiktionary {
		t.Fatalf("got %+v, want Wiktionary", res)
	}
	if res.Definition.Senses[0].Gloss != "To move quickly." {
		t.Fatalf("gloss = %q", res.Definition.Senses[0].Gloss)
	}
}
