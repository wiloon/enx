package adapters

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"enx-api/dictionary"
	"enx-api/ecdict/ecdicttest"
	"enx-api/utils/sqlitex"
	"enx-api/wiktionarybuild/wiktionarytest"
)

func TestWiktionaryReadsAKeyInDisplayOrder(t *testing.T) {
	file := OpenWiktionary(wiktionarytest.Create(t,
		`{"word":"Leave","lang_code":"en","pos":"verb","sounds":[{"ipa":"/liːv/","tags":["US"]}],"senses":[{"glosses":["To go."],"examples":[{"text":"Leave now."},{"text":"Second."}]},{"glosses":["To let be."]}],"forms":[{"form":"left","tags":["past"]},{"form":"left","tags":["participle","past"]}]}`,
		`{"word":"leave","lang_code":"en","pos":"noun","sounds":[{"ipa":"/lɛv/","tags":["UK"]}],"senses":[{"glosses":["Time off."]}]}`,
		`{"word":"left","lang_code":"en","pos":"verb","sounds":[{"ipa":"/lɛft/","tags":["US"]},{"ipa":"/left/","tags":["UK"]}],"senses":[{"glosses":["past of leave"],"form_of":[{"word":"leave"}],"tags":["form-of","past"]}]}`,
	))
	if !file.Available() {
		t.Fatal("not available")
	}

	leave, err := file.Read(context.Background(), "leave")
	if err != nil {
		t.Fatal(err)
	}
	wantEntries := []dictionary.WiktionaryEntry{
		{POS: "verb", IPA: dictionary.IPA{US: "/liːv/"}, Senses: []dictionary.WiktionarySense{{Gloss: "To go.", Example: "Leave now."}, {Gloss: "To let be."}}},
		{POS: "noun", IPA: dictionary.IPA{UK: "/lɛv/"}, Senses: []dictionary.WiktionarySense{{Gloss: "Time off."}}},
	}
	if !reflect.DeepEqual(leave.Entries, wantEntries) || len(leave.Forms) != 0 || len(leave.FormIPA) != 0 {
		t.Errorf("leave = %+v", leave)
	}

	left, err := file.Read(context.Background(), "left")
	if err != nil {
		t.Fatal(err)
	}
	if len(left.Entries) != 0 || !reflect.DeepEqual(left.FormIPA, []dictionary.IPA{{US: "/lɛft/", UK: "/left/"}}) {
		t.Errorf("left = %+v", left)
	}
	if len(left.Forms) == 0 || left.Forms[0].LemmaKey != "leave" || len(left.Forms[0].Tags) == 0 {
		t.Errorf("left forms = %+v", left.Forms)
	}

	if unknown, err := file.Read(context.Background(), "zzxqv"); err != nil || !reflect.DeepEqual(unknown, dictionary.WiktionaryRecords{}) {
		t.Errorf("unknown = %+v, %v", unknown, err)
	}
}

func TestWiktionaryIsUnavailableWithoutAUsableFile(t *testing.T) {
	notADatabase := filepath.Join(t.TempDir(), "wiktionary-2026-10-30.db")
	if err := os.WriteFile(notADatabase, []byte("not a database, but long enough to be read as one"), 0o600); err != nil {
		t.Fatal(err)
	}
	otherFormat := wiktionarytest.Create(t, `{"word":"run","lang_code":"en","pos":"verb","senses":[{"glosses":["g"]}]}`)
	db, err := sql.Open("sqlite", otherFormat)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE meta SET value = '2' WHERE key = 'schema_version'`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "missing.db")
	for _, path := range []string{"", missing, notADatabase, otherFormat} {
		if OpenWiktionary(path).Available() {
			t.Errorf("%q: available", path)
		}
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Errorf("opening a missing file created it: %v", err)
	}
}

// formsFile is a built file with forms that have entries of their own, and the
// ECDICT translations the build reads to tell which of them are only forms.
func formsFile(t *testing.T) string {
	t.Helper()
	own := func(word, pos, ipa string) string {
		return `{"word":"` + word + `","lang_code":"en","pos":"` + pos + `","sounds":[{"ipa":"` + ipa + `","tags":["US"]}],"senses":[{"glosses":["Own ` + word + `."]}]}`
	}
	lemma := func(word, forms string) string {
		return `{"word":"` + word + `","lang_code":"en","pos":"verb","sounds":[{"ipa":"/lemma/","tags":["US"]}],"senses":[{"glosses":["To ` + word + `."]}],"forms":[` + forms + `]}`
	}
	return wiktionarytest.CreateWithECDICT(t, []ecdicttest.Row{
		{Word: "was", Translation: "be的过去式"},
		{Word: "ran", Translation: "v. run的过去式"},
		{Word: "has", Translation: "have的第三人称单数现在式"},
		{Word: "are", Translation: "be的现在时复数或第二人称单数"},
		{Word: "left", Translation: `a. 左边的\nleave的过去式`},
	},
		lemma("be", `{"form":"was","tags":["past"]},{"form":"are","tags":["present","plural"]}`),
		lemma("run", `{"form":"ran","tags":["past"]}`),
		lemma("have", `{"form":"has","tags":["present","singular","third-person"]}`),
		lemma("leave", `{"form":"left","tags":["past"]}`),
		lemma("write", `{"form":"wrote","tags":["past"]}`),
		own("was", "verb", "/wʌz/"),
		own("ran", "noun", "/ræn/"),
		own("has", "noun", "/hæz/"),
		own("are", "noun", "/ɑɹ/"),
		own("left", "adj", "/lɛft/"),
		own("wrote", "name", "/ɹoʊt/"),
	)
}

func TestLookupExplainsTheLemmaOfAFormECDICTKnowsOnlyAsOne(t *testing.T) {
	setupWordsDB(t)
	service := dictionary.NewService(WordsTable{}, Ecdict{}, nil, OpenWiktionary(formsFile(t)))

	for _, tc := range []struct{ word, gloss, note, ipa string }{
		{"was", "To be.", "past tense of be", "/wʌz/"},
		{"ran", "To run.", "past tense of run", "/ræn/"},
		{"has", "To have.", "third-person singular of have", "/hæz/"},
		{"are", "To be.", "plural of be", "/ɑɹ/"},
		// Not in ECDICT, and its own entries are all proper names.
		{"wrote", "To write.", "past tense of write", "/ɹoʊt/"},
		// ECDICT has a sense of its own for it: its own entries, no note.
		{"left", "Own left.", "", "/lɛft/"},
	} {
		res, err := service.Resolve(context.Background(), tc.word, "u1", dictionary.LanguageEnglish)
		if err != nil {
			t.Fatal(err)
		}
		def := res.Definition
		if def == nil || len(def.Senses) != 1 || def.Senses[0].Gloss != tc.gloss ||
			def.LemmaNote != tc.note || def.PronunciationUS != tc.ipa {
			t.Errorf("%s: definition %+v; want %q, note %q, IPA %s", tc.word, def, tc.gloss, tc.note, tc.ipa)
		}
	}
}

func TestWiktionaryReadsTheLemmaPreferredMark(t *testing.T) {
	path := formsFile(t)
	marked := func(file *Wiktionary, key string) bool {
		t.Helper()
		records, err := file.Read(context.Background(), key)
		if err != nil || len(records.Entries) == 0 {
			t.Fatalf("read %s = %+v, %v", key, records, err)
		}
		return records.LemmaPreferred
	}

	file := OpenWiktionary(path)
	if !marked(file, "was") || marked(file, "left") {
		t.Errorf("was %v, left %v; want only was marked", marked(file, "was"), marked(file, "left"))
	}

	// A file built before the table existed: it opens, and marks nothing.
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP TABLE lemma_preferred`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	old := OpenWiktionary(path)
	if !old.Available() || marked(old, "was") {
		t.Errorf("available %v; want an old file readable with no marks", old.Available())
	}
}

func TestWordsTableIDFindsAnyLiveRow(t *testing.T) {
	setupWordsDB(t)
	empty := seedEmptyWord(t, "don't")
	ai := seedWord(t, "light", "光")
	if err := sqlitex.DB.Exec("UPDATE words SET source = 'ai' WHERE id = ?", ai).Error; err != nil {
		t.Fatal(err)
	}
	gone := seedWord(t, "gone", "走")
	if err := sqlitex.DB.Exec("UPDATE words SET deleted_at = 2 WHERE id = ?", gone).Error; err != nil {
		t.Fatal(err)
	}

	for english, want := range map[string]string{"Don’t": empty, "Light": ai, "gone": "", "unknown": ""} {
		id, ok, err := (WordsTable{}).ID(context.Background(), english)
		if err != nil || id != want || ok != (want != "") {
			t.Errorf("ID(%q) = %q, %v, %v; want %q", english, id, ok, err, want)
		}
	}
}

func TestWordsTableAddStoresAWiktionaryRowWithoutChinese(t *testing.T) {
	setupWordsDB(t)
	entry := dictionary.Entry{English: "went", Origin: dictionary.OriginWiktionary}

	id, err := (WordsTable{}).Add(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	if row := wordRow(t, id); row.Chinese != "" || row.Pronunciation != "" || row.Source != "wiktionary" {
		t.Fatalf("row = %+v", row)
	}

	// A concurrent lookup that added it first keeps its row as it is.
	again, err := (WordsTable{}).Add(context.Background(), entry)
	if err != nil || again != id {
		t.Fatalf("second Add = %q, %v; want %s", again, err, id)
	}
}
