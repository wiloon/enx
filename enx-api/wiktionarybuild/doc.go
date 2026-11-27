// Package wiktionarybuild turns kaikki.org's Wiktextract data into the
// read-only SQLite file English-English lookups read (ADR-098, #1233).
// cmd/wiktionary-build runs it, and wiktionarytest builds fixture files with
// it. The server binary does not import it.
package wiktionarybuild
