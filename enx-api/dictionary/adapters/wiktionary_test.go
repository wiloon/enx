package adapters

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"enx-api/dictionary"
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
