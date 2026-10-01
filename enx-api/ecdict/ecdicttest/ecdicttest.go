// Package ecdicttest writes throwaway ECDICT databases for tests. It uses the
// upstream stardict schema -- in particular `word ... COLLATE NOCASE` -- so
// tests see the same matching rules as production. Hand-written fixtures with
// a plain `word TEXT` column once made a redundant case-insensitive query
// look necessary.
package ecdicttest

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/glebarez/go-sqlite"
)

// Row is one stardict entry; the columns enx reads.
type Row struct {
	Word, Sw, Phonetic, Translation, Exchange string
}

// schema is ECDICT 1.0.28's stardict table and indexes, verbatim.
const schema = `
CREATE TABLE "stardict" (
"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,
"word" VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
"sw" VARCHAR(64) COLLATE NOCASE NOT NULL,
"phonetic" VARCHAR(64),
"definition" TEXT,
"translation" TEXT,
"pos" VARCHAR(16),
"collins" INTEGER DEFAULT(0),
"oxford" INTEGER DEFAULT(0),
"tag" VARCHAR(64),
"bnc" INTEGER DEFAULT(NULL),
"frq" INTEGER DEFAULT(NULL),
"exchange" TEXT,
"detail" TEXT,
"audio" TEXT
);
CREATE UNIQUE INDEX "stardict_1" ON stardict (id);
CREATE UNIQUE INDEX "stardict_2" ON stardict (word);
CREATE INDEX "stardict_3" ON stardict (sw, word collate nocase);
CREATE INDEX "sd_1" ON stardict (word collate nocase);
`

// Create writes a stardict database holding rows to a temp file and returns
// its path, for ecdict.Init. A Row with an empty Sw gets Word as its Sw.
func Create(t testing.TB, rows ...Row) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "stardict.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		sw := r.Sw
		if sw == "" {
			sw = r.Word
		}
		if _, err := db.Exec(`INSERT INTO stardict (word, sw, phonetic, translation, exchange) VALUES (?, ?, ?, ?, ?)`,
			r.Word, sw, r.Phonetic, r.Translation, r.Exchange); err != nil {
			t.Fatalf("insert %q: %v", r.Word, err)
		}
	}
	return path
}
