package ecdict

import (
	"regexp"
	"strings"
)

// brokenLongSchwa matches ECDICT's corrupted long schwa. About 1,300
// stardict.phonetic values (1.0.28) carry two literal backslashes where the
// vowel of "nurse" belongs -- "universally" is `ju:ni'v\\:sәli` -- and a few
// dozen of those have stray spaces around the colon (`di't\\ : rәbl`).
var brokenLongSchwa = regexp.MustCompile(`\\\\\s*:\s*`)

// longSchwa is how ECDICT itself spells that vowel in its intact entries
// ("nurse" is `nә:s`): U+04D9 followed by an ASCII colon.
const longSchwa = "ә:"

// CleanPhonetic repairs the corrupted long schwa in an ECDICT phonetic,
// leaving every other value unchanged. ECDICT is read-only, so the repair is
// applied on the way out of it, never written back. The same corruption also
// turned ʊ into "j" in some entries; that is indistinguishable from a real
// "j" and is left alone.
func CleanPhonetic(phonetic string) string {
	if !strings.Contains(phonetic, `\`) {
		return phonetic
	}
	return brokenLongSchwa.ReplaceAllString(phonetic, longSchwa)
}
