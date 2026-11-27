package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	"enx-api/dictionary"
	"enx-api/utils/logger"

	_ "github.com/glebarez/go-sqlite"
)

// wiktionarySchema is the file format this adapter reads
// (wiktionarybuild writes it).
const wiktionarySchema = "1"

// Wiktionary is the dictionary.Wiktionary backed by the Wiktionary file
// (ADR-098): a third-party file like ECDICT, opened read-only and never
// migrated or edited.
type Wiktionary struct {
	db *sql.DB // nil: unavailable
}

// OpenWiktionary opens the file at path. An empty, missing or unreadable one
// is logged and leaves English-English unavailable, as with ECDICT.
func OpenWiktionary(path string) *Wiktionary {
	if path == "" {
		logger.Warnf("WIKTIONARY_DB_PATH not set, English-English lookups will be unavailable")
		return &Wiktionary{}
	}
	db, err := openWiktionaryFile(path)
	if err != nil {
		logger.Warnf("could not open the Wiktionary file %s, English-English lookups will be unavailable: %v", path, err)
		return &Wiktionary{}
	}
	logger.Infof("Wiktionary file opened (read-only): %s", path)
	return &Wiktionary{db: db}
}

func openWiktionaryFile(path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	// A URI, so that a "?" or "#" in the path stays part of the file name.
	db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro"}).String())
	if err != nil {
		return nil, err
	}
	var version string
	err = db.QueryRow(`SELECT value FROM meta WHERE key = 'schema_version'`).Scan(&version)
	if err == nil && version != wiktionarySchema {
		err = fmt.Errorf("schema_version %q, want %q", version, wiktionarySchema)
	}
	if err != nil {
		return nil, errors.Join(err, db.Close())
	}
	return db, nil
}

func (w *Wiktionary) Available() bool { return w.db != nil }

func (w *Wiktionary) Read(ctx context.Context, key string) (dictionary.WiktionaryRecords, error) {
	var records dictionary.WiktionaryRecords
	// Senses come in their entry's rank order, so a new id starts an entry.
	var lastEntry int64
	err := w.each(ctx, `
		SELECT e.id, e.pos, COALESCE(e.ipa_us, ''), COALESCE(e.ipa_uk, ''), s.gloss,
		  COALESCE((SELECT x.text FROM examples x WHERE x.sense_id = s.id ORDER BY x.idx LIMIT 1), '')
		FROM entries e JOIN senses s ON s.entry_id = e.id
		WHERE e.key = ? ORDER BY e.rank, e.id, s.idx`, key, func(rows *sql.Rows) error {
		var id int64
		var entry dictionary.WiktionaryEntry
		var sense dictionary.WiktionarySense
		if err := rows.Scan(&id, &entry.POS, &entry.IPA.US, &entry.IPA.UK, &sense.Gloss, &sense.Example); err != nil {
			return err
		}
		if len(records.Entries) == 0 || id != lastEntry {
			records.Entries = append(records.Entries, entry)
			lastEntry = id
		}
		last := &records.Entries[len(records.Entries)-1]
		last.Senses = append(last.Senses, sense)
		return nil
	})
	if err != nil {
		return dictionary.WiktionaryRecords{}, err
	}
	err = w.each(ctx, `SELECT lemma, lemma_key, tags FROM forms WHERE key = ? ORDER BY rowid`, key, func(rows *sql.Rows) error {
		var form dictionary.WiktionaryForm
		var tags string
		if err := rows.Scan(&form.Lemma, &form.LemmaKey, &tags); err != nil {
			return err
		}
		form.Tags = strings.Fields(tags)
		records.Forms = append(records.Forms, form)
		return nil
	})
	if err != nil {
		return dictionary.WiktionaryRecords{}, err
	}
	err = w.each(ctx, `SELECT COALESCE(ipa_us, ''), COALESCE(ipa_uk, '') FROM form_ipa WHERE key = ? ORDER BY rowid`, key, func(rows *sql.Rows) error {
		var ipa dictionary.IPA
		if err := rows.Scan(&ipa.US, &ipa.UK); err != nil {
			return err
		}
		records.FormIPA = append(records.FormIPA, ipa)
		return nil
	})
	if err != nil {
		return dictionary.WiktionaryRecords{}, err
	}
	return records, nil
}

// each runs query for key and scans every row.
func (w *Wiktionary) each(ctx context.Context, query, key string, scan func(*sql.Rows) error) error {
	rows, err := w.db.QueryContext(ctx, query, key)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
