package dictionary

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type fakeWiktionary struct {
	unavailable bool
	keys        map[string]WiktionaryRecords
	err         error
	read        []string
}

func (f *fakeWiktionary) Available() bool { return !f.unavailable }

func (f *fakeWiktionary) Read(_ context.Context, key string) (WiktionaryRecords, error) {
	f.read = append(f.read, key)
	return f.keys[key], f.err
}

func entry(pos string, glosses ...string) WiktionaryEntry {
	e := WiktionaryEntry{POS: pos}
	for _, g := range glosses {
		e.Senses = append(e.Senses, WiktionarySense{Gloss: g})
	}
	return e
}

func form(lemma, tags string) WiktionaryForm {
	return WiktionaryForm{Lemma: lemma, LemmaKey: strings.ToLower(lemma), Tags: strings.Fields(tags)}
}

func newEnglishService(keys map[string]WiktionaryRecords) (*Service, *fakeWords, *fakeExternal, *fakeWiktionary) {
	words := newFakeWords()
	external := &fakeExternal{entries: map[string]Entry{"run": run}}
	wiktionary := &fakeWiktionary{keys: keys}
	return NewService(words, external, &fakeEntitlements{}, wiktionary), words, external, wiktionary
}

func resolveEnglish(t *testing.T, svc *Service, word string) Result {
	t.Helper()
	res, err := svc.Resolve(context.Background(), word, "u1", LanguageEnglish)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestResolveInEnglishReadsWiktionaryAndCachesTheECDICTRow(t *testing.T) {
	svc, words, _, wiktionary := newEnglishService(map[string]WiktionaryRecords{
		"run": {Entries: []WiktionaryEntry{{
			POS: "verb", IPA: IPA{US: "/rʌn/", UK: "/ɹʌn/"},
			Senses: []WiktionarySense{{Gloss: "To move fast.", Example: "Run home."}},
		}}},
	})

	res := resolveEnglish(t, svc, "Run")

	want := &EnglishDefinition{
		Senses:          []Sense{{POS: "verb", Gloss: "To move fast.", Example: "Run home."}},
		PronunciationUS: "/rʌn/", PronunciationUK: "/ɹʌn/",
	}
	if res.English != "Run" || res.Source != SourceWiktionary || res.Origin != OriginWiktionary ||
		res.Chinese != "" || res.Pronunciation != "" || !reflect.DeepEqual(res.Definition, want) {
		t.Fatalf("result %+v, definition %+v", res, res.Definition)
	}
	if !reflect.DeepEqual(wiktionary.read, []string{"run"}) {
		t.Fatalf("read %v, want the key", wiktionary.read)
	}
	// "Run" is not in the fake ECDICT, which matches case: the row is the key's.
	if res.ID != "id-run" || !reflect.DeepEqual(words.added, []Entry{{English: "run", Origin: OriginWiktionary}}) {
		t.Fatalf("id %q, added %+v", res.ID, words.added)
	}
}

func TestResolveInEnglishCreatesTheRowAsECDICTDoes(t *testing.T) {
	svc, words, _, _ := newEnglishService(map[string]WiktionaryRecords{"run": {Entries: []WiktionaryEntry{entry("verb", "g")}}})

	res := resolveEnglish(t, svc, "run")

	if res.ID != "id-run" || !reflect.DeepEqual(words.added, []Entry{run}) || res.Chinese != "" {
		t.Fatalf("id %q, added %+v, chinese %q; want the ECDICT row, not shown", res.ID, words.added, res.Chinese)
	}
}

func TestResolveInEnglishKeepsAnExistingRowsID(t *testing.T) {
	for name, row := range map[string]Entry{
		"with Chinese":    {English: "run", Chinese: "跑"},
		"without Chinese": {English: "run", Origin: OriginWiktionary},
		"made by AI":      {English: "run", Chinese: "跑", Origin: OriginAI},
	} {
		t.Run(name, func(t *testing.T) {
			svc, words, external, _ := newEnglishService(map[string]WiktionaryRecords{"run": {Entries: []WiktionaryEntry{entry("verb", "g")}}})
			words.seed("w1", row)

			res := resolveEnglish(t, svc, "run")

			if res.ID != "w1" || res.Chinese != "" || len(words.added) != 0 || len(external.queried) != 0 {
				t.Fatalf("result %+v, added %v, asked %v; want the row's id only", res, words.added, external.queried)
			}
		})
	}
}

func TestResolveInEnglishCreatesARowWithoutChineseWhenECDICTHasNoAnswer(t *testing.T) {
	for name, breakECDICT := range map[string]func(*fakeExternal){
		"miss":        func(f *fakeExternal) { f.entries = nil },
		"timeout":     func(f *fakeExternal) { f.err = ErrExternalTimeout },
		"error":       func(f *fakeExternal) { f.err = errors.New("disk") },
		"unavailable": func(f *fakeExternal) { f.unavailable = true },
	} {
		t.Run(name, func(t *testing.T) {
			svc, words, external, _ := newEnglishService(map[string]WiktionaryRecords{"don't": {Entries: []WiktionaryEntry{entry("verb", "g")}}})
			breakECDICT(external)

			res := resolveEnglish(t, svc, "Don’t")

			want := []Entry{{English: "don't", Origin: OriginWiktionary}}
			if res.Source != SourceWiktionary || res.ID != "id-don't" || !reflect.DeepEqual(words.added, want) {
				t.Fatalf("result %+v, added %+v; want found with a Chinese-less row", res, words.added)
			}
		})
	}
}

func TestResolveInEnglishAnswersWithoutAnIDWhenTheRowCannotBeStored(t *testing.T) {
	for name, breakStore := range map[string]func(*fakeWords){
		"add fails":  func(f *fakeWords) { f.addErr = errors.New("read-only") },
		"read fails": func(f *fakeWords) { f.findErr = errors.New("db down") },
	} {
		t.Run(name, func(t *testing.T) {
			svc, words, _, _ := newEnglishService(map[string]WiktionaryRecords{"leave": {Entries: []WiktionaryEntry{entry("verb", "g")}}})
			breakStore(words)

			res := resolveEnglish(t, svc, "leave")

			if res.Source != SourceWiktionary || res.ID != "" {
				t.Fatalf("result %+v, want found without an id", res)
			}
		})
	}
}

func TestResolveInEnglishNeverAnswersAMissOrAFailureInChinese(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want Source
	}{
		"miss":       {nil, SourceMiss},
		"read error": {errors.New("corrupt"), SourceError},
	} {
		t.Run(name, func(t *testing.T) {
			svc, words, external, wiktionary := newEnglishService(nil)
			wiktionary.err = tc.err
			words.seed("w1", Entry{English: "run", Chinese: "跑"})

			res := resolveEnglish(t, svc, "run")

			if res != (Result{English: "run", Source: tc.want}) || len(words.added) != 0 || len(external.queried) != 0 {
				t.Fatalf("result %+v, added %v, asked %v", res, words.added, external.queried)
			}
		})
	}
}

func TestResolveInEnglishWithAnUnavailableWiktionary(t *testing.T) {
	svc, _, _, wiktionary := newEnglishService(nil)
	wiktionary.unavailable = true

	_, err := svc.Resolve(context.Background(), "run", "u1", LanguageEnglish)

	if !errors.Is(err, ErrWiktionaryUnavailable) || len(wiktionary.read) != 0 {
		t.Fatalf("err %v, read %v", err, wiktionary.read)
	}
}

func TestResolveInEnglishExplainsAFormByItsLemma(t *testing.T) {
	svc, words, external, _ := newEnglishService(map[string]WiktionaryRecords{
		"went": {Forms: []WiktionaryForm{form("go", "past")}, FormIPA: []IPA{{US: "/wɛnt/"}}},
		"go":   {Entries: []WiktionaryEntry{{POS: "verb", IPA: IPA{US: "/ɡoʊ/", UK: "/ɡəʊ/"}, Senses: []WiktionarySense{{Gloss: "To move."}}}}},
	})
	external.entries = nil

	res := resolveEnglish(t, svc, "went")

	// The headword and the pronunciation are the clicked word's own.
	want := &EnglishDefinition{Senses: []Sense{{POS: "verb", Gloss: "To move."}}, LemmaNote: "past tense of go", PronunciationUS: "/wɛnt/"}
	if res.English != "went" || !reflect.DeepEqual(res.Definition, want) {
		t.Fatalf("result %+v, definition %+v", res, res.Definition)
	}
	if !reflect.DeepEqual(words.added, []Entry{{English: "went", Origin: OriginWiktionary}}) {
		t.Fatalf("added %+v, want the clicked word's row", words.added)
	}
}

func TestResolveInEnglishShowsAWordsOwnEntriesWithoutALemmaNote(t *testing.T) {
	for word, forms := range map[string][]WiktionaryForm{
		"left": {form("left", "alternative"), form("leave", "past")},
		"run":  {form("rin", "participle past")},
		"get":  {form("git", "alternative")},
	} {
		t.Run(word, func(t *testing.T) {
			svc, _, _, wiktionary := newEnglishService(map[string]WiktionaryRecords{
				word: {Entries: []WiktionaryEntry{entry("verb", "Own.")}, Forms: forms},
			})

			res := resolveEnglish(t, svc, word)

			want := []Sense{{POS: "verb", Gloss: "Own."}}
			if res.Definition.LemmaNote != "" || !reflect.DeepEqual(res.Definition.Senses, want) {
				t.Fatalf("definition %+v", res.Definition)
			}
			if !reflect.DeepEqual(wiktionary.read, []string{word}) {
				t.Fatalf("read %v, want the lemma not read", wiktionary.read)
			}
		})
	}
}

func TestResolveInEnglishExplainsALemmaPreferredKeyByItsLemma(t *testing.T) {
	svc, _, _, _ := newEnglishService(map[string]WiktionaryRecords{
		"ran": {
			LemmaPreferred: true,
			Entries:        []WiktionaryEntry{{POS: "noun", IPA: IPA{US: "/ræn/"}, Senses: []WiktionarySense{{Gloss: "Yarns."}}}},
			Forms:          []WiktionaryForm{form("run", "past")},
		},
		"run": {Entries: []WiktionaryEntry{{POS: "verb", IPA: IPA{US: "/rʌn/", UK: "/ɹʌn/"}, Senses: []WiktionarySense{{Gloss: "To move fast."}}}}},
	})

	res := resolveEnglish(t, svc, "ran")

	want := &EnglishDefinition{Senses: []Sense{{POS: "verb", Gloss: "To move fast."}}, LemmaNote: "past tense of run", PronunciationUS: "/ræn/"}
	if !reflect.DeepEqual(res.Definition, want) {
		t.Fatalf("definition %+v", res.Definition)
	}
}

func TestResolveInEnglishUsesTheFirstOfSeveralLemmas(t *testing.T) {
	svc, _, _, _ := newEnglishService(map[string]WiktionaryRecords{
		"axes": {Forms: []WiktionaryForm{form("axes", "alternative"), form("ax", "plural"), form("axis", "plural"), form("ax", "third-person")}},
		"ax":   {Entries: []WiktionaryEntry{entry("noun", "A tool.")}},
		"axis": {Entries: []WiktionaryEntry{entry("noun", "A line.")}},
	})

	res := resolveEnglish(t, svc, "axes")

	// All tags of the chosen lemma count: third-person outranks plural.
	if res.Definition.LemmaNote != "third-person singular of ax" || len(res.Definition.Senses) != 1 || res.Definition.Senses[0].Gloss != "A tool." {
		t.Fatalf("definition %+v", res.Definition)
	}
}

func TestLemmaNoteTakesTheFirstMatchingRule(t *testing.T) {
	for _, tc := range []struct {
		rows []string // the tags of each forms row
		want string
	}{
		{[]string{"plural", "misspelling alternative"}, "misspelling of x"},
		{[]string{"abbreviation alt-of"}, "abbreviation of x"},
		{[]string{"initialism"}, "abbreviation of x"},
		{[]string{"acronym"}, "abbreviation of x"},
		{[]string{"alt-of plural"}, "alternative form of x"},
		{[]string{"alternative"}, "alternative form of x"},
		{[]string{"plural", "present singular third-person"}, "third-person singular of x"},
		{[]string{"plural past"}, "past tense of x"},
		// A past row's person and number say nothing about the relation: "ran",
		// "was", "were" and "went".
		{[]string{"past singular third-person"}, "past tense of x"},
		{[]string{"first-person past singular"}, "past tense of x"},
		{[]string{"past plural"}, "past tense of x"},
		{[]string{"past"}, "past tense of x"},
		// A row that is not past still counts beside a past one.
		{[]string{"past", "present singular third-person"}, "third-person singular of x"},
		{[]string{"past singular third-person", "plural"}, "plural of x"},
		{[]string{"past plural", "plural"}, "plural of x"},
		{[]string{"participle past", "past"}, "past tense of x"},
		{[]string{"participle past"}, "past participle of x"},
		{[]string{"gerund"}, "present participle of x"},
		{[]string{"participle present"}, "present participle of x"},
		{[]string{"comparative"}, "comparative of x"},
		{[]string{"superlative"}, "superlative of x"},
		{[]string{"present"}, "form of x"},
		{[]string{""}, "form of x"},
	} {
		var forms []WiktionaryForm
		for _, tags := range tc.rows {
			forms = append(forms, form("x", tags))
		}
		svc, _, _, _ := newEnglishService(map[string]WiktionaryRecords{
			"y": {Forms: forms},
			"x": {Entries: []WiktionaryEntry{entry("noun", "g")}},
		})
		if got := resolveEnglish(t, svc, "y").Definition.LemmaNote; got != tc.want {
			t.Errorf("tags %q: note %q, want %q", tc.rows, got, tc.want)
		}
	}
}

func TestResolveInEnglishTakesEachPronunciationFromEntriesThenForms(t *testing.T) {
	svc, _, _, _ := newEnglishService(map[string]WiktionaryRecords{
		"read": {
			Entries: []WiktionaryEntry{entry("verb", "g"), {POS: "noun", IPA: IPA{US: "second"}, Senses: []WiktionarySense{{Gloss: "n"}}}},
			FormIPA: []IPA{{US: "form-us"}, {UK: "form-uk"}, {UK: "later"}},
		},
	})

	def := resolveEnglish(t, svc, "read").Definition

	if def.PronunciationUS != "second" || def.PronunciationUK != "form-uk" {
		t.Fatalf("US %q UK %q", def.PronunciationUS, def.PronunciationUK)
	}
}

func TestResolveInEnglishKeepsTenSensesInOrder(t *testing.T) {
	first, second := entry("noun"), entry("verb")
	for i := range 7 {
		first.Senses = append(first.Senses, WiktionarySense{Gloss: "n" + strconv.Itoa(i)})
		second.Senses = append(second.Senses, WiktionarySense{Gloss: "v" + strconv.Itoa(i)})
	}
	svc, _, _, _ := newEnglishService(map[string]WiktionaryRecords{"set": {Entries: []WiktionaryEntry{first, second}}})

	senses := resolveEnglish(t, svc, "set").Definition.Senses

	if len(senses) != 10 || senses[0].Gloss != "n0" || senses[7].Gloss != "v0" || senses[9].Gloss != "v2" {
		t.Fatalf("senses %+v", senses)
	}
}

func TestEntriesCountsAnEnglishHitAsFoundAndChargesAsInChinese(t *testing.T) {
	for _, lang := range []Language{LanguageZhHans, LanguageEnglish} {
		svc, _, _, _ := newEnglishService(map[string]WiktionaryRecords{"run": {Entries: []WiktionaryEntry{entry("verb", "g")}}})
		meter := &fakeMeter{}
		entries := NewEntries(svc, meter, nil, nil, &fakeLanguages{lang: lang})

		results, err := entries.Lookup(context.Background(), "u1", []string{"run"})

		if err != nil {
			t.Fatal(err)
		}
		if results[0].Status != EntryFound || results[0].Language != lang || !reflect.DeepEqual(meter.charges, []int{1}) {
			t.Errorf("%s: %+v, charges %v", lang, results[0], meter.charges)
		}
	}
}
