package wiktionarybuild

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"enx-api/ecdict/ecdicttest"
)

func gzipped(t *testing.T, data []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// newOptions writes input (already compressed) to a temp directory and returns
// Options that build it into an empty output directory.
func newOptions(t *testing.T, input []byte, ecdict ...ecdicttest.Row) Options {
	t.Helper()
	path := filepath.Join(t.TempDir(), "input.jsonl.gz")
	if err := os.WriteFile(path, input, 0o600); err != nil {
		t.Fatal(err)
	}
	return Options{
		Input:      path,
		ECDICT:     ecdicttest.Create(t, ecdict...),
		Out:        filepath.Join(t.TempDir(), "wiktionary.db"),
		SourceDate: "2026-10-30",
		Log:        io.Discard,
	}
}

func openRO(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func build(t *testing.T, name string, ecdict ...ecdicttest.Row) *sql.DB {
	t.Helper()
	opts := newOptions(t, gzipped(t, fixture(t, name)), ecdict...)
	if err := Run(context.Background(), opts); err != nil {
		t.Fatalf("run: %v", err)
	}
	return openRO(t, opts.Out)
}

// rows returns each result row as its columns joined by "|", NULL as "NULL".
func rows(t *testing.T, db *sql.DB, query string, args ...any) []string {
	t.Helper()
	res, err := db.Query(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Close() }()
	cols, err := res.Columns()
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for res.Next() {
		values := make([]sql.NullString, len(cols))
		dest := make([]any, len(cols))
		for i := range values {
			dest[i] = &values[i]
		}
		if err := res.Scan(dest...); err != nil {
			t.Fatal(err)
		}
		parts := make([]string, len(cols))
		for i, v := range values {
			parts[i] = "NULL"
			if v.Valid {
				parts[i] = v.String
			}
		}
		out = append(out, strings.Join(parts, "|"))
	}
	if err := res.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func assertRows(t *testing.T, db *sql.DB, query string, want ...string) {
	t.Helper()
	if got := rows(t, db, query); !slices.Equal(got, want) {
		t.Errorf("%s\n got %q\nwant %q", query, got, want)
	}
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestNonEnglishLineIsSkipped(t *testing.T) {
	db := build(t, "senses.jsonl")
	assertRows(t, db, `SELECT word, pos, etymology FROM entries ORDER BY id`, "dog|noun|1")
}

func TestOldAndGlosslessSensesAreDropped(t *testing.T) {
	db := build(t, "senses.jsonl")
	assertRows(t, db, `SELECT idx, gloss, tags FROM senses ORDER BY id`,
		"0|A domesticated canine.|countable informal",
		"1|A contemptible person.|")
}

func TestArchaicFormOfSenseMakesNoFormsRow(t *testing.T) {
	db := build(t, "senses.jsonl")
	assertRows(t, db, `SELECT * FROM forms`)
	assertRows(t, db, `SELECT value FROM meta WHERE key = 'forms_dropped_missing_lemma'`, "0")
}

func TestQuotationsAndCitedExamplesAreDropped(t *testing.T) {
	db := build(t, "senses.jsonl")
	assertRows(t, db, `SELECT s.gloss, x.idx, x.text FROM examples x JOIN senses s ON s.id = x.sense_id ORDER BY x.idx`,
		"A domesticated canine.|0|The dog barked.",
		"A domesticated canine.|1|A hot dog is not a dog.")
}

func TestFormOfSenseBecomesFormsRowNotEntry(t *testing.T) {
	db := build(t, "forms.jsonl")
	assertRows(t, db, `SELECT key, lemma, lemma_key, tags FROM forms WHERE key = 'goed'`, "goed|go|go|past nonstandard")
	assertRows(t, db, `SELECT word FROM entries ORDER BY id`, "go")
	assertRows(t, db, `SELECT * FROM senses WHERE gloss LIKE '% of %'`)
}

func TestLemmaFormsBecomeFormsRowsWithoutSkippedTags(t *testing.T) {
	db := build(t, "forms.jsonl")
	// "quiet" has no sense left, so it is no entry: its forms[] row is made
	// anyway and then dropped for the missing lemma.
	assertRows(t, db, `SELECT key, tags FROM forms WHERE key <> 'goed' ORDER BY key, tags`,
		"goes|present singular", "went|past")
}

func TestSameRelationIsStoredOnce(t *testing.T) {
	// "went"|go|past comes from go's forms[] and from two form-of entries.
	db := build(t, "forms.jsonl")
	assertRows(t, db, `SELECT lemma, tags FROM forms WHERE key = 'went'`, "go|past")
}

func TestFormsRowWithoutLemmaEntryIsDeletedAndCounted(t *testing.T) {
	db := build(t, "forms.jsonl")
	assertRows(t, db, `SELECT * FROM forms WHERE lemma IN ('color', 'quiet')`)
	assertRows(t, db, `SELECT value FROM meta WHERE key = 'forms_dropped_missing_lemma'`, "2")
}

func TestFormOnlyEntryWithIPAGetsFormIPARow(t *testing.T) {
	// One row for the two identical "went" entries; none for "colour" (its
	// forms row was dropped), "quiet" (no form-of sense) or "goed" (no IPA).
	db := build(t, "forms.jsonl")
	assertRows(t, db, `SELECT key, pos, ipa_us, ipa_uk FROM form_ipa`, "went|verb|/wɛnt/|NULL")
}

func TestKeysFollowWordformKey(t *testing.T) {
	db := build(t, "keys-ipa.jsonl")
	assertRows(t, db, `SELECT word, key FROM entries WHERE id = 1`, "Don’t|don't")
	assertRows(t, db, `SELECT key, lemma, lemma_key FROM forms`, "don'ts|Don’t|don't")
	assertRows(t, db, `SELECT word FROM entries WHERE key = '' OR word = '''s'`)
}

func TestIPAPicksUSAndUKAndUntaggedFillsUS(t *testing.T) {
	db := build(t, "keys-ipa.jsonl")
	assertRows(t, db, `SELECT word, ipa_us, ipa_uk FROM entries WHERE word IN ('Don’t', 'both', 'untagged', 'british') ORDER BY id`,
		"Don’t|NULL|NULL",
		"both|/ga/|/rp/",
		"untagged|/first/|NULL",
		"british|NULL|/uk/")
}

func TestRankFollowsECDICTPosOrder(t *testing.T) {
	db := build(t, "rank.jsonl",
		ecdicttest.Row{Word: "Polish", Pos: "n:15/v:60/j:20/u:5"},
		ecdicttest.Row{Word: "slow"})
	assertRows(t, db, `SELECT rank, word, pos, etymology FROM entries WHERE key = 'polish' ORDER BY rank`,
		"0|Polish|verb|NULL",
		"1|Polish|adj|NULL",
		"2|polish|noun|1",
		"3|polish|noun|2",
		"4|polish|name|NULL",
		"5|polish|intj|NULL")
	// No ECDICT row, and a row with an empty pos: input order.
	assertRows(t, db, `SELECT key, rank, pos FROM entries WHERE key IN ('fast', 'slow') ORDER BY key, rank`,
		"fast|0|adv", "fast|1|noun", "slow|0|verb", "slow|1|adj")
}

func TestMetaHoldsBuildFactsAndCounts(t *testing.T) {
	input := gzipped(t, fixture(t, "forms.jsonl"))
	opts := newOptions(t, input)
	var log bytes.Buffer
	opts.Log = &log
	if err := Run(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	meta := map[string]string{}
	for _, row := range rows(t, openRO(t, opts.Out), `SELECT key, value FROM meta`) {
		key, value, _ := strings.Cut(row, "|")
		meta[key] = value
	}
	sum := sha256.Sum256(input)
	for key, want := range map[string]string{
		"schema_version":              "1",
		"source_url":                  "https://kaikki.org/dictionary/rawdata.html",
		"source_date":                 "2026-10-30",
		"input_sha256":                hex.EncodeToString(sum[:]),
		"builder_version":             builderVersion,
		"licence":                     "CC BY-SA 4.0",
		"entries_rows":                "1",
		"senses_rows":                 "1",
		"examples_rows":               "0",
		"forms_rows":                  "3",
		"form_ipa_rows":               "1",
		"lemma_preferred_rows":        "0",
		"forms_dropped_missing_lemma": "2",
	} {
		if meta[key] != want {
			t.Errorf("meta[%q] = %q, want %q", key, meta[key], want)
		}
		if !strings.Contains(log.String(), key+": "+want) {
			t.Errorf("log does not print %q: %q", key+": "+want, log.String())
		}
	}
	if _, err := time.Parse(time.RFC3339, meta["built_at"]); err != nil {
		t.Errorf("built_at: %v", err)
	}
}

func TestSHA256SUMSIsChecked(t *testing.T) {
	input := gzipped(t, fixture(t, "senses.jsonl"))
	sum := sha256.Sum256(input)
	good := hex.EncodeToString(sum[:])
	for name, tc := range map[string]struct {
		sums    string
		wantErr bool
	}{
		"match":         {good + "  input.jsonl.gz\n", false},
		"binary marker": {good + " *input.jsonl.gz\n", false},
		"other file":    {strings.Repeat("0", 64) + "  other.gz\n", false},
		"mismatch":      {strings.Repeat("0", 64) + "  input.jsonl.gz\n", true},
	} {
		t.Run(name, func(t *testing.T) {
			opts := newOptions(t, input)
			if err := os.WriteFile(filepath.Join(filepath.Dir(opts.Input), "SHA256SUMS"), []byte(tc.sums), 0o600); err != nil {
				t.Fatal(err)
			}
			err := Run(context.Background(), opts)
			if tc.wantErr {
				if err == nil || !strings.Contains(err.Error(), "SHA256SUMS") {
					t.Fatalf("err = %v, want a SHA256SUMS mismatch", err)
				}
				if names := dirNames(t, filepath.Dir(opts.Out)); len(names) != 0 {
					t.Errorf("output directory holds %q", names)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOutputOpensReadOnlyFromReadOnlyLocation(t *testing.T) {
	opts := newOptions(t, gzipped(t, fixture(t, "senses.jsonl")))
	if err := Run(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if names := dirNames(t, filepath.Dir(opts.Out)); !slices.Equal(names, []string{"wiktionary.db"}) {
		t.Errorf("output directory holds %q", names)
	}
	info, err := os.Stat(opts.Out)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o644 {
		t.Errorf("mode = %o, want 644", mode)
	}

	data, err := os.ReadFile(opts.Out)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	copied := filepath.Join(dir, "copy.db")
	if err := os.WriteFile(copied, data, 0o400); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	db := openRO(t, copied)
	assertRows(t, db, `SELECT word FROM entries WHERE key = 'dog'`, "dog")
	assertRows(t, db, `PRAGMA journal_mode`, "delete")
	assertRows(t, db, `SELECT name FROM sqlite_schema WHERE type = 'index' ORDER BY name`,
		"entries_key", "examples_sense", "form_ipa_key", "forms_key", "senses_entry",
		"sqlite_autoindex_lemma_preferred_1", "sqlite_autoindex_meta_1")
	assertRows(t, db, `SELECT DISTINCT tbl FROM sqlite_stat1 WHERE tbl = 'entries'`, "entries")
}

func TestExistingOutputIsRefused(t *testing.T) {
	opts := newOptions(t, gzipped(t, fixture(t, "senses.jsonl")))
	if err := os.WriteFile(opts.Out, []byte("keep me"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("err = %v, want already exists", err)
	}
	if data, err := os.ReadFile(opts.Out); err != nil || string(data) != "keep me" {
		t.Errorf("out = %q, %v", data, err)
	}
}

func TestSourceDateMustBeYearMonthDay(t *testing.T) {
	for _, date := range []string{"", "2026-1-3", "30-10-2026", "2026-02-30", "2026-10-30T00:00:00Z"} {
		opts := newOptions(t, gzipped(t, fixture(t, "senses.jsonl")))
		opts.SourceDate = date
		if err := Run(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "source-date") {
			t.Errorf("source date %q: err = %v", date, err)
		}
	}
}

func TestFailedBuildLeavesNothingBehind(t *testing.T) {
	good := fixture(t, "senses.jsonl")
	whole := gzipped(t, good)
	for name, tc := range map[string]struct {
		input []byte
		want  string
	}{
		"bad line":       {gzipped(t, append(slices.Clone(good), "{\"word\": \n"...)), "line 4"},
		"truncated gzip": {whole[:len(whole)-10], "unexpected EOF"},
		"corrupt gzip":   {append(slices.Clone(whole[:len(whole)-8]), 0, 0, 0, 0, 0, 0, 0, 0), "gzip"},
	} {
		t.Run(name, func(t *testing.T) {
			opts := newOptions(t, tc.input)
			err := Run(context.Background(), opts)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want %q", err, tc.want)
			}
			if names := dirNames(t, filepath.Dir(opts.Out)); len(names) != 0 {
				t.Errorf("output directory holds %q", names)
			}
		})
	}
}

// The input is a named pipe, so the context is cancelled (what SIGINT and
// SIGTERM do) while the build is certainly under way.
func TestCancelledBuildLeavesNothingBehind(t *testing.T) {
	opts := newOptions(t, nil)
	if err := os.Remove(opts.Input); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(opts.Input, 0o600); err != nil {
		t.Fatal(err)
	}
	outDir := filepath.Dir(opts.Out)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, opts) }()

	// Opened read-write so that it never blocks, even if run fails early.
	pipe, err := os.OpenFile(opts.Input, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pipe.Close() }()
	lines := fixture(t, "senses.jsonl")
	zw := gzip.NewWriter(pipe)
	if _, err := zw.Write(lines); err != nil {
		t.Fatal(err)
	}
	if err := zw.Flush(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for len(dirNames(t, outDir)) == 0 {
		select {
		case err := <-done:
			t.Fatalf("run ended before it was cancelled: %v", err)
		case <-time.After(10 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatal("no temporary file appeared")
		}
	}
	cancel()
	if _, err := zw.Write(lines); err != nil {
		t.Fatal(err)
	}
	// End of input: gzip.Reader holds data back while it waits for what
	// follows a member.
	if err := errors.Join(zw.Close(), pipe.Close()); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v, want context.Canceled", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run did not stop")
	}
	if names := dirNames(t, outDir); len(names) != 0 {
		t.Errorf("output directory holds %q", names)
	}
}
