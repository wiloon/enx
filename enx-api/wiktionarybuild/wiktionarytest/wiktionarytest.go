// Package wiktionarytest builds throwaway Wiktionary files for tests with the
// real builder, so tests read the same format as production.
package wiktionarytest

import (
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"enx-api/ecdict/ecdicttest"
	"enx-api/wiktionarybuild"
)

// Create builds a Wiktionary file from Wiktextract JSONL lines, one object
// per argument, and returns its path.
func Create(t testing.TB, lines ...string) string {
	t.Helper()
	dir := t.TempDir()
	input := filepath.Join(dir, "input.jsonl.gz")
	f, err := os.Create(input)
	if err != nil {
		t.Fatal(err)
	}
	zw := gzip.NewWriter(f)
	if _, err := io.WriteString(zw, strings.Join(lines, "\n")+"\n"); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "wiktionary-2026-10-30.db")
	err = wiktionarybuild.Run(context.Background(), wiktionarybuild.Options{
		Input:      input,
		ECDICT:     ecdicttest.Create(t),
		Out:        out,
		SourceDate: "2026-10-30",
		Log:        io.Discard,
	})
	if err != nil {
		t.Fatalf("build Wiktionary file: %v", err)
	}
	return out
}
