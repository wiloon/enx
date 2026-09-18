package dictsample

import (
	"fmt"
	"strings"
	"testing"

	"github.com/spf13/viper"
)

// capture swaps the log sink for the duration of a test and returns the
// lines that were emitted.
func capture(t *testing.T) *[]string {
	t.Helper()
	var lines []string
	prev := logf
	logf = func(msg string, args ...interface{}) {
		lines = append(lines, fmt.Sprintf(msg, args...))
	}
	t.Cleanup(func() { logf = prev })
	return &lines
}

func enable(t *testing.T, on bool) {
	t.Helper()
	prev := viper.GetBool("ecdict.sampling")
	viper.Set("ecdict.sampling", on)
	t.Cleanup(func() { viper.Set("ecdict.sampling", prev) })
}

// The whole package must be inert until switched on -- it ships disabled
// and a deploy that forgets about it should cost nothing.
func TestSilentWhenDisabled(t *testing.T) {
	enable(t, false)
	lines := capture(t)

	Word("serendipity", SourceEcdict)
	Phrase("kick the bucket")

	if len(*lines) != 0 {
		t.Fatalf("expected no output while disabled, got %v", *lines)
	}
}

func TestWordLineShape(t *testing.T) {
	enable(t, true)

	cases := []struct {
		name string
		text string
		src  Source
		want string
	}{
		{"ecdict hit", "serendipity", SourceEcdict,
			`DICTSAMPLE kind=word src=ecdict found=1 wc=1 text="serendipity"`},
		{"local cache hit counts as resolved", "cat", SourceLocal,
			`DICTSAMPLE kind=word src=local found=1 wc=1 text="cat"`},
		{"miss", "doomscrolling", SourceNone,
			`DICTSAMPLE kind=word src=none found=0 wc=1 text="doomscrolling"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lines := capture(t)
			Word(tc.text, tc.src)
			if len(*lines) != 1 {
				t.Fatalf("want 1 line, got %d: %v", len(*lines), *lines)
			}
			if (*lines)[0] != tc.want {
				t.Errorf("line mismatch\n got: %s\nwant: %s", (*lines)[0], tc.want)
			}
		})
	}
}

// A single-word call to the in-context endpoint is an ordinary word
// lookup that the dictionary path already recorded -- counting it again
// here would double it in the denominator.
func TestPhraseIgnoresSingleWords(t *testing.T) {
	enable(t, true)
	lines := capture(t)

	Phrase("serendipity")
	Phrase("   ")
	Phrase("")

	if len(*lines) != 0 {
		t.Fatalf("expected single words and blanks to be skipped, got %v", *lines)
	}
}

func TestPhraseRecordsWordCount(t *testing.T) {
	enable(t, true)

	for _, tc := range []struct {
		text string
		want int
	}{
		{"take on", 2},
		{"kick the bucket", 3},
		{"let the cat out of the bag", 7},
		{"  irregular   inner   spacing  ", 3},
	} {
		t.Run(tc.text, func(t *testing.T) {
			lines := capture(t)
			Phrase(tc.text)
			if len(*lines) != 1 {
				t.Fatalf("want 1 line, got %v", *lines)
			}
			want := fmt.Sprintf("wc=%d", tc.want)
			if !strings.Contains((*lines)[0], want) {
				t.Errorf("line %q does not carry %s", (*lines)[0], want)
			}
		})
	}
}

// A selection carrying a quote or a newline must not be able to forge a
// field or split the line -- the output is machine-parsed later.
func TestTextIsQuotedSoItCannotForgeFields(t *testing.T) {
	enable(t, true)
	lines := capture(t)

	Phrase("he said \"run\"\nfound=1 wc=99")

	if len(*lines) != 1 {
		t.Fatalf("want 1 line, got %v", *lines)
	}
	got := (*lines)[0]
	if strings.Contains(got, "\n") {
		t.Errorf("newline leaked into the line: %q", got)
	}
	if !strings.Contains(got, `found=0`) {
		t.Errorf("real found field missing: %q", got)
	}
	if !strings.Contains(got, `\"run\"`) {
		t.Errorf("inner quotes not escaped: %q", got)
	}
}
