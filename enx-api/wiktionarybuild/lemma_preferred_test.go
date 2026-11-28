package wiktionarybuild

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"enx-api/ecdict/ecdicttest"
)

// marks builds "ran", a form of "run" whose one own entry has part of speech
// pos, and returns the lemma_preferred keys.
func marks(t *testing.T, pos string, ecdict ...ecdicttest.Row) []string {
	t.Helper()
	input := `{"word":"run","lang_code":"en","pos":"verb","senses":[{"glosses":["g"]}],"forms":[{"form":"ran","tags":["past"]}]}
{"word":"ran","lang_code":"en","pos":"` + pos + `","senses":[{"glosses":["own"]}]}
`
	opts := newOptions(t, gzipped(t, []byte(input)), ecdict...)
	if err := Run(context.Background(), opts); err != nil {
		t.Fatalf("run: %v", err)
	}
	return rows(t, openRO(t, opts.Out), `SELECT key FROM lemma_preferred ORDER BY key`)
}

func TestECDICTTranslationOfOnlyLemmaReferencesMarksTheKey(t *testing.T) {
	for name, translation := range map[string]string{
		"past":                    "run的过去式",
		"POS prefix":              "v. run的过去式",
		"third person present":    "have的第三人称单数现在式",
		"joined by 或":             "be的现在时复数或第二人称单数",
		"joined by 和":             "v. straggle的过去式和过去分词",
		"adjacent terms and 形式":   "go的过去式过去分词形式",
		"every other conjunction": "be的单数与复数及比较级或最高级和第一人称单数",
		"several references":      "v. lie的过去式; lay的过去分词；lie的现在分词, lay的现在式，lay的现在时",
		"lines and blank lines":   "v. run的过去式\n\n n.run的复数\r\n",
		"literal backslash n":     `v. run的过去式\nadj. run的比较级\n`,
	} {
		t.Run(name, func(t *testing.T) {
			// stardict.word is NOCASE: "Ran" answers for the key "ran".
			got := marks(t, "noun", ecdicttest.Row{Word: "Ran", Translation: translation})
			if !slices.Equal(got, []string{"ran"}) {
				t.Errorf("%q: marked %q, want ran", translation, got)
			}
		})
	}
}

func TestECDICTTranslationWithAnOwnSenseDoesNotMarkTheKey(t *testing.T) {
	for name, translation := range map[string]string{
		"gloss":                          "n. 左边",
		"reference inside a gloss":       "v. 蔓延( straggle的过去式和过去分词 ); 散漫",
		"gloss line beside a reference":  "a. 一文不名的\nbreak的过去式",
		"gloss after a literal newline":  `break的过去式\na. 一文不名的`,
		"gloss after a reference":        "see的过去式, 锯",
		"unknown relation":               "run的名词",
		"text after the relation":        "run的过去式变体",
		"prefix with no reference":       "v.",
		"conjunction with nothing after": "run的过去式和",
	} {
		t.Run(name, func(t *testing.T) {
			// A proper-name entry changes nothing: ECDICT has answered.
			got := marks(t, "name", ecdicttest.Row{Word: "ran", Translation: translation})
			if len(got) != 0 {
				t.Errorf("%q: marked %q", translation, got)
			}
		})
	}
}

func TestWithoutAnECDICTTranslationOnlyProperNamesAreMarked(t *testing.T) {
	for name, ecdict := range map[string][]ecdicttest.Row{
		"no row":            nil,
		"empty translation": {{Word: "ran"}},
		"blank lines only":  {{Word: "ran", Translation: `\n`}},
	} {
		t.Run(name, func(t *testing.T) {
			if got := marks(t, "name", ecdict...); !slices.Equal(got, []string{"ran"}) {
				t.Errorf("a name: marked %q, want ran", got)
			}
			if got := marks(t, "noun", ecdict...); len(got) != 0 {
				t.Errorf("a noun: marked %q", got)
			}
		})
	}
}

func TestNULLTranslationFallsBackToProperNames(t *testing.T) {
	opts := newOptions(t, gzipped(t, fixture(t, "lemma-preferred.jsonl")), ecdicttest.Row{Word: "gone"})
	ecdict, err := sql.Open("sqlite", opts.ECDICT)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ecdict.Exec(`UPDATE stardict SET translation = NULL`); err != nil {
		t.Fatal(err)
	}
	if err := ecdict.Close(); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), opts); err != nil {
		t.Fatalf("run: %v", err)
	}
	assertRows(t, openRO(t, opts.Out), `SELECT key FROM lemma_preferred`, "gone")
}

func TestOnlyAFormWithEntriesOfItsOwnIsMarkedAndCounted(t *testing.T) {
	// "gone" is a form with a proper name only; "mixed" has an adjective too;
	// "goes" has no entry; "go" is no form; "self" is a form of itself only.
	db := build(t, "lemma-preferred.jsonl",
		ecdicttest.Row{Word: "goes", Translation: "go的第三人称单数"},
		ecdicttest.Row{Word: "go", Translation: "go的现在式"},
		ecdicttest.Row{Word: "self", Translation: "self的过去式"})
	assertRows(t, db, `SELECT key FROM lemma_preferred ORDER BY key`, "gone")
	assertRows(t, db, `SELECT value FROM meta WHERE key = 'lemma_preferred_rows'`, "1")
	assertRows(t, db, `SELECT value FROM meta WHERE key = 'schema_version'`, "1")
}

func TestRelationLabelsURLsAndCitationsAreNotExamples(t *testing.T) {
	db := build(t, "examples.jsonl")
	assertRows(t, db, `SELECT text FROM examples ORDER BY rowid`,
		"In 1990, Germany reunified.",
		"The dog barked.",
		"See also the appendix.",
		"Synonyms are words of like meaning.",
		"2007 was a good year.",
		"May 5 people join?")
	assertRows(t, db, `SELECT value FROM meta WHERE key = 'examples_rows'`, "6")
	assertRows(t, db, `SELECT value FROM meta WHERE key = 'builder_version'`, "2")
	// A sense whose examples were all dropped has none.
	assertRows(t, db, `SELECT s.gloss FROM senses s WHERE NOT EXISTS (SELECT 1 FROM examples x WHERE x.sense_id = s.id)`,
		"Only labels.")
}
