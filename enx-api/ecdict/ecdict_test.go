package ecdict

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"enx-api/ecdict/ecdicttest"
)

func use(t *testing.T, rows ...ecdicttest.Row) {
	t.Helper()
	Init(ecdicttest.Create(t, rows...))
	if !IsAvailable() {
		t.Fatal("expected ECDICT available")
	}
	t.Cleanup(func() { Init("") })
}

var run = ecdicttest.Row{Word: "run", Phonetic: "/rʌn/", Translation: "跑", Exchange: "i:running/p:ran/d:ran"}

func TestInitUnavailableWhenPathEmpty(t *testing.T) {
	Init("")
	if IsAvailable() {
		t.Fatal("expected ECDICT unavailable when path is empty")
	}
	if UnavailableMessage() == "" {
		t.Fatal("expected unavailable message")
	}
}

// stardict.word is COLLATE NOCASE, so the exact step already matches any
// case; there is no separate case-insensitive step.
func TestFindExactMatchesAnyCase(t *testing.T) {
	use(t, ecdicttest.Row{Word: "Hello", Translation: "你好"})

	for _, w := range []string{"Hello", "hello", "HELLO"} {
		row, matchedBy, err := Find(context.Background(), w)
		if err != nil || matchedBy != "exact" || row.Translation != "你好" {
			t.Fatalf("Find(%q) = %+v, %q, %v; want the exact match", w, row, matchedBy, err)
		}
	}
}

func TestFindViaSw(t *testing.T) {
	use(t, ecdicttest.Row{Word: "U.S.", Sw: "us", Translation: "美国"})

	row, matchedBy, err := Find(context.Background(), "us")
	if err != nil || matchedBy != "sw" || row.Word != "U.S." {
		t.Fatalf("got %+v, %q, %v; want U.S. via sw", row, matchedBy, err)
	}
}

func TestFindViaExchange(t *testing.T) {
	use(t, run)

	row, matchedBy, err := Find(context.Background(), "running")
	if err != nil || matchedBy != "exchange" || row.Word != "run" || row.Exchange == "" {
		t.Fatalf("got %+v, %q, %v; want run via exchange", row, matchedBy, err)
	}
}

// The three exchange patterns are tried in one scan but keep their order:
// a ":form/" match beats an alphabetically earlier "/form/" match.
func TestFindExchangeKeepsPatternPrecedence(t *testing.T) {
	use(t,
		ecdicttest.Row{Word: "aaa", Translation: "x", Exchange: "d:foo/ran/i:bar"},
		ecdicttest.Row{Word: "run", Translation: "跑", Exchange: "p:ran/d:ran"},
	)

	row, _, err := Find(context.Background(), "ran")
	if err != nil || row.Word != "run" {
		t.Fatalf("got %+v, %v; want run (pattern \":ran/\" first)", row, err)
	}
}

func TestFindNotFound(t *testing.T) {
	use(t, run)

	if _, _, err := Find(context.Background(), "zzxqv"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

func TestFindTimeout(t *testing.T) {
	use(t, run)
	prev := queryTimeout
	queryTimeout = time.Nanosecond
	t.Cleanup(func() { queryTimeout = prev })

	if _, _, err := Find(context.Background(), "zzxqv"); !errors.Is(err, ErrTimeout) {
		t.Fatalf("got %v, want ErrTimeout", err)
	}
}

// A request the caller abandoned is not a timeout and not a miss.
func TestFindCallerCanceled(t *testing.T) {
	use(t, run)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, _, err := Find(ctx, "zzxqv")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}

// A broken database is an error, never "not found".
func TestFindDatabaseError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.db")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	Init(path) // opens, but has no stardict table
	t.Cleanup(func() { Init("") })

	_, _, err := Find(context.Background(), "run")
	if err == nil || errors.Is(err, ErrNotFound) || errors.Is(err, ErrTimeout) {
		t.Fatalf("got %v, want the database error", err)
	}
}

func TestFindUnavailable(t *testing.T) {
	Init("")
	if _, _, err := Find(context.Background(), "run"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
}

// LookupRaw (admin page) keeps its found-or-not shape on top of Find.
func TestLookupRaw(t *testing.T) {
	use(t, run)

	if row, matchedBy, found := LookupRaw(context.Background(), "RUN"); !found || matchedBy != "exact" || row.Word != "run" {
		t.Fatalf("got %+v, %q, %v", row, matchedBy, found)
	}
	if _, _, found := LookupRaw(context.Background(), "zzxqv"); found {
		t.Fatal("found a word absent from ECDICT")
	}
}

func TestInitMissingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-ecdict.db")
	Init(missing)
	if IsAvailable() {
		t.Fatal("expected unavailable for missing file")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatalf("unexpected stat: %v", err)
	}
}

func TestInitOpensReadOnly(t *testing.T) {
	use(t, run)
}
