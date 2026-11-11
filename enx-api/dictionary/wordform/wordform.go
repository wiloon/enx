// Package wordform turns a token from a page into the form a word is looked
// up under. It sits apart from package dictionary because enx, which
// package dictionary depends on through stats and middleware, uses it too.
package wordform

import (
	"regexp"
	"strings"
)

// nonEnglish matches everything Clean strips from a token. Compiled once:
// it runs for every word of every page (paragraph-init).
var nonEnglish = regexp.MustCompile(`[^a-zA-Z\-'’ ]+`)

// Clean drops everything but letters, hyphens, apostrophes and spaces
// ("morning." -> "morning"). It keeps the page's spelling otherwise.
func Clean(raw string) string {
	return nonEnglish.ReplaceAllString(raw, "")
}

// Normalize is the form raw is looked up under: Clean, then stray trailing
// punctuation trimmed and Canonical applied. Case is kept.
func Normalize(raw string) string {
	raw = Clean(raw)

	english := raw
	if !strings.Contains(raw, "'s") &&
		!strings.Contains(raw, "’s") &&
		!strings.Contains(raw, "'t") &&
		!strings.Contains(raw, "'ve") &&
		!strings.Contains(raw, "'m") &&
		!strings.Contains(raw, "'d") &&
		!strings.Contains(raw, "'re") {
		english = strings.TrimSuffix(english, "-")
		english = strings.TrimSuffix(english, "’")
		english = strings.TrimSuffix(english, ".")
		english = strings.TrimSuffix(english, ",")
		english = strings.TrimPrefix(english, "(")
		english = strings.TrimSuffix(english, ")")
		english = Clean(english)
	}

	if strings.HasSuffix(english, "-") || strings.HasSuffix(english, " ") {
		english = english[:len(english)-1]
	}
	return Canonical(english)
}

// Canonical straightens curly apostrophes ("don’t" -> "don't", ADR-043) and
// drops a possessive "'s" ("dog's" -> "dog").
func Canonical(english string) string {
	english = strings.ReplaceAll(english, "’", "'")
	return strings.ReplaceAll(english, "'s", "")
}
