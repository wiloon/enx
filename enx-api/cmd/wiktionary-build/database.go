package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	_ "github.com/glebarez/go-sqlite"
)

// The Wiktionary file's format. Bump schema_version (build.go) when the tables
// or their meaning change. The temp tables hold the rows that are only written
// once every entry is known.
const tables = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE entries (
  id        INTEGER PRIMARY KEY,
  word      TEXT NOT NULL,
  key       TEXT NOT NULL,
  pos       TEXT NOT NULL,
  etymology INTEGER,
  ipa_us    TEXT,
  ipa_uk    TEXT,
  rank      INTEGER NOT NULL
);
CREATE TABLE senses (
  id       INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  idx      INTEGER NOT NULL,
  gloss    TEXT NOT NULL,
  tags     TEXT NOT NULL
);
CREATE TABLE examples (
  sense_id INTEGER NOT NULL REFERENCES senses(id),
  idx      INTEGER NOT NULL,
  text     TEXT NOT NULL
);
CREATE TABLE forms (
  key       TEXT NOT NULL,
  lemma     TEXT NOT NULL,
  lemma_key TEXT NOT NULL,
  tags      TEXT NOT NULL
);
CREATE TABLE form_ipa (
  key    TEXT NOT NULL,
  pos    TEXT NOT NULL,
  ipa_us TEXT,
  ipa_uk TEXT
);
CREATE TEMP TABLE forms_load (key TEXT, lemma TEXT, lemma_key TEXT, tags TEXT);
CREATE TEMP TABLE form_ipa_load (key TEXT, pos TEXT, ipa_us TEXT, ipa_uk TEXT);
CREATE TEMP TABLE pos_share (key TEXT, pos TEXT, share REAL, PRIMARY KEY (key, pos));
`

// database is the file being built, loaded in one transaction.
type database struct {
	db *sql.DB
	tx *sql.Tx

	entry, sense, example, form, formIPA *sql.Stmt
}

// sqliteURI is path as a SQLite URI, so that a "?" or "#" in it stays part of
// the file name.
func sqliteURI(path, query string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return (&url.URL{Scheme: "file", Path: abs, RawQuery: query}).String(), nil
}

func openECDICT(ctx context.Context, path string) (*sql.DB, error) {
	uri, err := sqliteURI(path, "mode=ro")
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return nil, err
	}
	// Fail now, not after the load, on a file that is not ECDICT.
	var pos sql.NullString
	err = db.QueryRowContext(ctx, `SELECT pos FROM stardict LIMIT 1`).Scan(&pos)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		_ = db.Close()
		return nil, fmt.Errorf("read ECDICT %s: %w", path, err)
	}
	return db, nil
}

func createDatabase(ctx context.Context, path string) (_ *database, err error) {
	uri, err := sqliteURI(path, "")
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return nil, err
	}
	// One connection: the pragmas and temp tables belong to it.
	db.SetMaxOpenConns(1)
	d := &database{db: db}
	defer func() {
		if err != nil {
			_ = d.close()
		}
	}()
	// No journal and never WAL: a failed build is deleted, and the file must
	// open read-only from a read-only location with nothing beside it.
	for _, pragma := range []string{`PRAGMA journal_mode=OFF`, `PRAGMA synchronous=OFF`, `PRAGMA cache_size=-262144`} {
		if _, err := db.ExecContext(ctx, pragma); err != nil {
			return nil, err
		}
	}
	if d.tx, err = db.BeginTx(ctx, nil); err != nil {
		return nil, err
	}
	if _, err := d.tx.ExecContext(ctx, tables); err != nil {
		return nil, err
	}
	for stmt, query := range map[**sql.Stmt]string{
		&d.entry:   `INSERT INTO entries (word, key, pos, etymology, ipa_us, ipa_uk, rank) VALUES (?, ?, ?, ?, ?, ?, 0)`,
		&d.sense:   `INSERT INTO senses (entry_id, idx, gloss, tags) VALUES (?, ?, ?, ?)`,
		&d.example: `INSERT INTO examples (sense_id, idx, text) VALUES (?, ?, ?)`,
		&d.form:    `INSERT INTO forms_load VALUES (?, ?, ?, ?)`,
		&d.formIPA: `INSERT INTO form_ipa_load VALUES (?, ?, ?, ?)`,
	} {
		if *stmt, err = d.tx.PrepareContext(ctx, query); err != nil {
			return nil, err
		}
	}
	return d, nil
}

// close may be called more than once.
func (d *database) close() error {
	if d.tx != nil {
		_ = d.tx.Rollback() // sql.ErrTxDone once finish has committed
	}
	return d.db.Close()
}

func optional(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (d *database) add(ctx context.Context, c converted) error {
	for _, f := range c.forms {
		if _, err := d.form.ExecContext(ctx, f.key, f.lemma, f.lemmaKey, f.tags); err != nil {
			return err
		}
	}
	if p := c.formIPA; p != nil {
		if _, err := d.formIPA.ExecContext(ctx, p.key, p.pos, optional(p.ipaUS), optional(p.ipaUK)); err != nil {
			return err
		}
	}
	e := c.entry
	if e == nil {
		return nil
	}
	res, err := d.entry.ExecContext(ctx, e.word, e.key, e.pos, e.etymology, optional(e.ipaUS), optional(e.ipaUK))
	if err != nil {
		return err
	}
	entryID, err := res.LastInsertId()
	if err != nil {
		return err
	}
	for i, s := range e.senses {
		res, err := d.sense.ExecContext(ctx, entryID, i, s.gloss, s.tags)
		if err != nil {
			return err
		}
		senseID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		for j, text := range s.examples {
			if _, err := d.example.ExecContext(ctx, senseID, j, text); err != nil {
				return err
			}
		}
	}
	return nil
}

type metaRow struct{ key, value string }

// finish applies the rules that need every entry, indexes and analyzes the
// file, and returns what it wrote to meta: facts followed by the counts.
func (d *database) finish(ctx context.Context, ecdict *sql.DB, facts []metaRow) ([]metaRow, error) {
	if err := d.exec(ctx,
		`CREATE INDEX entries_key ON entries(key)`,
		// Duplicates are stored once; a relation whose lemma has no entry not at all.
		`INSERT INTO forms
		 SELECT key, lemma, lemma_key, tags FROM forms_load l
		 WHERE EXISTS (SELECT 1 FROM entries e WHERE e.key = l.lemma_key)
		 GROUP BY key, lemma, tags ORDER BY MIN(l.rowid)`,
		`CREATE INDEX forms_key ON forms(key)`,
		`INSERT INTO form_ipa
		 SELECT key, pos, ipa_us, ipa_uk FROM form_ipa_load l
		 WHERE EXISTS (SELECT 1 FROM forms f WHERE f.key = l.key)
		 GROUP BY key, pos, ipa_us, ipa_uk ORDER BY MIN(l.rowid)`,
		`CREATE INDEX form_ipa_key ON form_ipa(key)`,
		`CREATE INDEX senses_entry ON senses(entry_id)`,
		`CREATE INDEX examples_sense ON examples(sense_id)`,
	); err != nil {
		return nil, err
	}
	if err := d.rank(ctx, ecdict); err != nil {
		return nil, fmt.Errorf("rank entries: %w", err)
	}

	meta := facts
	for _, count := range []struct{ key, query string }{
		{"entries_rows", `SELECT COUNT(*) FROM entries`},
		{"senses_rows", `SELECT COUNT(*) FROM senses`},
		{"examples_rows", `SELECT COUNT(*) FROM examples`},
		{"forms_rows", `SELECT COUNT(*) FROM forms`},
		{"form_ipa_rows", `SELECT COUNT(*) FROM form_ipa`},
		{"forms_dropped_missing_lemma", `SELECT COUNT(*) FROM (
			SELECT 1 FROM forms_load l
			WHERE NOT EXISTS (SELECT 1 FROM entries e WHERE e.key = l.lemma_key)
			GROUP BY key, lemma, tags)`},
	} {
		var n int64
		if err := d.tx.QueryRowContext(ctx, count.query).Scan(&n); err != nil {
			return nil, err
		}
		meta = append(meta, metaRow{count.key, strconv.FormatInt(n, 10)})
	}
	for _, row := range meta {
		if _, err := d.tx.ExecContext(ctx, `INSERT INTO meta VALUES (?, ?)`, row.key, row.value); err != nil {
			return nil, err
		}
	}
	if err := d.tx.Commit(); err != nil {
		return nil, err
	}
	// "main": the temp tables stay out of the statistics.
	if _, err := d.db.ExecContext(ctx, `ANALYZE main`); err != nil {
		return nil, err
	}
	return meta, nil
}

func (d *database) exec(ctx context.Context, statements ...string) error {
	for _, s := range statements {
		if _, err := d.tx.ExecContext(ctx, s); err != nil {
			name, _, _ := strings.Cut(s, "\n")
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

// rank sets each entry's display order among the entries of its key: ECDICT's
// larger part-of-speech share first, otherwise input order.
func (d *database) rank(ctx context.Context, ecdict *sql.DB) error {
	// ECDICT is asked by key: stardict.word is NOCASE, so "polish" and
	// "Polish" are ranked together.
	lookup, err := ecdict.PrepareContext(ctx, `SELECT COALESCE(pos, '') FROM stardict WHERE word = ?`)
	if err != nil {
		return err
	}
	defer func() { _ = lookup.Close() }()
	insert, err := d.tx.PrepareContext(ctx, `INSERT INTO pos_share VALUES (?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = insert.Close() }()

	// A key with one part of speech keeps input order whatever the shares say.
	keys, err := d.tx.QueryContext(ctx, `SELECT key FROM entries GROUP BY key HAVING COUNT(DISTINCT pos) > 1`)
	if err != nil {
		return err
	}
	defer func() { _ = keys.Close() }()
	for keys.Next() {
		var key, field string
		if err := keys.Scan(&key); err != nil {
			return err
		}
		if err := lookup.QueryRowContext(ctx, key).Scan(&field); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		for pos, share := range posShares(field) {
			if _, err := insert.ExecContext(ctx, key, pos, share); err != nil {
				return err
			}
		}
	}
	if err := errors.Join(keys.Err(), keys.Close()); err != nil {
		return err
	}
	// DESC sorts NULL, a part of speech ECDICT does not list, last.
	return d.exec(ctx, `UPDATE entries SET rank = r.rank FROM (
		SELECT e.id, ROW_NUMBER() OVER (PARTITION BY e.key ORDER BY s.share DESC, e.id) - 1 AS rank
		FROM entries e LEFT JOIN pos_share s ON s.key = e.key AND s.pos = e.pos
	) AS r WHERE entries.id = r.id AND r.rank > 0`)
}
