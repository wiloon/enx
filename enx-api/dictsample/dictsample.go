// Package dictsample emits the one-off measurement lines behind ADR-030
// Decision 0: the ECDICT miss rate (②) and the shape of drag-selected
// phrases (④). Those two numbers decide whether ENX adds a second
// dictionary source at all, and whether phrase lookup starts consulting
// the dictionary (Decision 8) -- today both questions are answered by
// guesswork because nothing records what the dictionary fails to resolve.
//
// It is deliberately a leaf package depending only on the logger and
// viper: it exists to be DELETED WHOLE once the two-week sample is in.
// Nothing should grow a dependency on it, and no behaviour should ever
// branch on what it records.
//
// Privacy (ADR-026 / ADR-028): a line carries the looked-up text and
// nothing else -- no user id, no URL, no surrounding sentence. "Which
// words does our users' reading fail to resolve" is an aggregate
// question, and it is answered here without knowing who asked. The
// phrase lines do carry a multi-word fragment of what someone was
// reading, which is why the whole thing is off unless explicitly
// enabled, and why it is time-boxed rather than permanent.
//
// Output format (one line, grep-able by the DICTSAMPLE prefix):
//
//	DICTSAMPLE kind=word src=ecdict found=1 wc=1 text="serendipity"
//	DICTSAMPLE kind=word src=none found=0 wc=1 text="doomscrolling"
//	DICTSAMPLE kind=phrase src=probe found=0 wc=3 text="kick the bucket"
//
// `src` says which layer answered: `local` = the words table, `ecdict` =
// ECDICT, `none` = nothing did. Phrase lines are `probe`: today phrases
// never reach a dictionary at all (Decision 8 is what would change
// that), so they are recorded only to be cross-matched against ECDICT
// and Wiktionary offline.
package dictsample

import (
	"strings"

	"enx-api/utils/logger"

	"github.com/spf13/viper"
)

// Source names the layer that answered a lookup.
type Source string

const (
	SourceLocal  Source = "local"  // the words table
	SourceEcdict Source = "ecdict" // ECDICT
	SourceNone   Source = "none"   // nothing resolved it
	SourceProbe  Source = "probe"  // not looked up at all, recorded for offline matching
)

// Enabled reports whether sampling is on. It is off by default: this is
// measurement scaffolding, and a deploy that forgets to turn it off
// should cost nothing.
func Enabled() bool {
	return viper.GetBool("ecdict.sampling")
}

// Word records one dictionary lookup and which layer answered it.
// Callers pass the text as the user typed/clicked it, not normalised --
// the classification step needs to see typos and casing to tell a real
// miss from noise.
func Word(text string, src Source) {
	emit("word", text, src)
}

// Phrase records a multi-word selection arriving at the AI in-context
// endpoint. Single-word calls are ignored: they are ordinary word
// lookups and are already recorded by Word.
func Phrase(text string) {
	if wordCount(text) < 2 {
		return
	}
	emit("phrase", text, SourceProbe)
}

// logf is the sink, swappable so the tests can assert on the exact line
// without standing up a zap logger. Production never reassigns it.
var logf = logger.Infof

func emit(kind, text string, src Source) {
	if !Enabled() {
		return
	}
	found := 0
	if src == SourceLocal || src == SourceEcdict {
		found = 1
	}
	// %q so a stray quote or newline in the selection cannot forge a
	// field or split the line -- the whole point is that this is
	// machine-parsed later.
	logf("DICTSAMPLE kind=%s src=%s found=%d wc=%d text=%q",
		kind, src, found, wordCount(text), text)
}

// wordCount counts whitespace-separated tokens, which is the same
// definition Decision 8's phrase bounds are written against and the same
// one the ECDICT measurement used (`word LIKE '% %'`).
func wordCount(text string) int {
	return len(strings.Fields(text))
}
