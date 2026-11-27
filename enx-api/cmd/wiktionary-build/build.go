package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const sourceURL = "https://kaikki.org/dictionary/rawdata.html"

type options struct {
	Input, ECDICT, Out, SourceDate string
	Log                            io.Writer // notes and the final meta counts
}

// run does the whole build. On failure, a cancelled ctx included, it leaves
// the output directory as it was.
func run(ctx context.Context, opts options) (err error) {
	defer func() {
		// SQLite reports an interrupted statement in its own words.
		if err != nil && ctx.Err() != nil && !errors.Is(err, ctx.Err()) {
			err = fmt.Errorf("%w (%v)", ctx.Err(), err)
		}
	}()

	if opts.Input == "" || opts.ECDICT == "" || opts.Out == "" {
		return errors.New("-input, -ecdict, -out and -source-date are all required")
	}
	if _, err := time.Parse(time.DateOnly, opts.SourceDate); err != nil {
		return fmt.Errorf("-source-date %q is not a YYYY-MM-DD date", opts.SourceDate)
	}
	if err := mustNotExist(opts.Out); err != nil {
		return err
	}
	wantSum, err := listedSHA256(opts.Input)
	if err != nil {
		return err
	}
	if wantSum == "" {
		_, _ = fmt.Fprintf(opts.Log, "note: no SHA256SUMS line for %s beside it; the input is not verified\n", filepath.Base(opts.Input))
	}

	input, err := os.Open(opts.Input)
	if err != nil {
		return err
	}
	defer func() { _ = input.Close() }()

	ecdict, err := openECDICT(ctx, opts.ECDICT)
	if err != nil {
		return err
	}
	defer func() { _ = ecdict.Close() }()

	tmpFile, err := os.CreateTemp(filepath.Dir(opts.Out), "."+filepath.Base(opts.Out)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := tmpFile.Name()
	defer func() {
		// After a successful rename none of these exist.
		for _, suffix := range []string{"", "-journal", "-wal", "-shm"} {
			if rmErr := os.Remove(tmp + suffix); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
				err = errors.Join(err, rmErr)
			}
		}
	}()
	if err := tmpFile.Close(); err != nil {
		return err
	}

	db, err := createDatabase(ctx, tmp)
	if err != nil {
		return err
	}
	defer func() { _ = db.close() }()

	hash := sha256.New()
	compressed := io.TeeReader(input, hash)
	if err := load(ctx, db, compressed); err != nil {
		return err
	}
	if _, err := io.Copy(io.Discard, compressed); err != nil {
		return err
	}
	gotSum := hex.EncodeToString(hash.Sum(nil))
	if wantSum != "" && !strings.EqualFold(wantSum, gotSum) {
		return fmt.Errorf("SHA256SUMS lists %s for the input, but its SHA-256 is %s", wantSum, gotSum)
	}

	meta, err := db.finish(ctx, ecdict, []metaRow{
		{"schema_version", "1"},
		{"source_url", sourceURL},
		{"source_date", opts.SourceDate},
		{"input_sha256", gotSum},
		{"builder_version", builderVersion},
		{"built_at", time.Now().UTC().Format(time.RFC3339)},
		{"licence", "CC BY-SA 4.0"},
	})
	if err != nil {
		return err
	}
	// The connection is closed before the rename.
	if err := db.close(); err != nil {
		return err
	}
	if err := publish(ctx, tmp, opts.Out); err != nil {
		return err
	}
	for _, row := range meta {
		_, _ = fmt.Fprintf(opts.Log, "%s: %s\n", row.key, row.value)
	}
	return nil
}

// load streams the gzipped input, one JSON object per line, into db.
func load(ctx context.Context, db *database, compressed io.Reader) error {
	unzipped, err := gzip.NewReader(compressed)
	if err != nil {
		return fmt.Errorf("read input: %w", err)
	}
	// ReadBytes, unlike bufio.Scanner, has no limit on the line length.
	lines := bufio.NewReaderSize(unzipped, 1<<20)
	for n := 1; ; n++ {
		line, readErr := lines.ReadBytes('\n')
		if err := ctx.Err(); err != nil {
			return err
		}
		if readErr != nil && readErr != io.EOF {
			return fmt.Errorf("read input at line %d: %w", n, readErr)
		}
		if len(line) > 0 {
			if err := addLine(ctx, db, line); err != nil {
				return fmt.Errorf("input line %d: %w", n, err)
			}
		}
		if readErr == io.EOF {
			return nil
		}
	}
}

// addLine adds an English line to db. Every line must be valid JSON, but only
// English ones have to have the shape the builder reads.
func addLine(ctx context.Context, db *database, line []byte) error {
	var language struct {
		LangCode string `json:"lang_code"`
	}
	if err := json.Unmarshal(line, &language); err != nil {
		return err
	}
	if language.LangCode != "en" {
		return nil
	}
	var w wiktextractEntry
	if err := json.Unmarshal(line, &w); err != nil {
		return err
	}
	return db.add(ctx, convert(w))
}

// listedSHA256 returns the hash a SHA256SUMS file beside input lists for it,
// or "" when there is no such file or line.
func listedSHA256(input string) (string, error) {
	data, err := os.ReadFile(filepath.Join(filepath.Dir(input), "SHA256SUMS"))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		// "<hash>  <name>", or "<hash> *<name>" for binary mode.
		sum, name, _ := strings.Cut(strings.TrimRight(line, "\r"), " ")
		name = strings.TrimPrefix(strings.TrimPrefix(name, " "), "*")
		if strings.TrimPrefix(name, "./") == filepath.Base(input) {
			return sum, nil
		}
	}
	return "", nil
}

func mustNotExist(out string) error {
	_, err := os.Lstat(out)
	if err == nil {
		return fmt.Errorf("output %s already exists; the builder never replaces a file", out)
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// publish makes the finished temporary file readable by all and renames it to
// out.
func publish(ctx context.Context, tmp, out string) error {
	if err := os.Chmod(tmp, 0o644); err != nil {
		return err
	}
	// The load ran with synchronous=OFF: flush before the file gets its name.
	f, err := os.Open(tmp)
	if err != nil {
		return err
	}
	if err := errors.Join(f.Sync(), f.Close()); err != nil {
		return err
	}
	// The build takes minutes: look again before renaming over anything.
	if err := mustNotExist(out); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(tmp, out)
}
