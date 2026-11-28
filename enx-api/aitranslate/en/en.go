// Package en holds what every AI call that explains in plain English shares:
// the reading level its prompt asks for and the check that the reply is not
// Chinese (ADR-098). It is a leaf package, mirroring aitranslate/zh.
package en

import (
	"errors"
	"strings"
	"unicode"
)

// Level is the CEFR level explanations are written at.
const Level = "CEFR B1"

// PlainRule pins the language and the reading level of an English prompt.
const PlainRule = "- Write only in plain English at " + Level + " level: common everyday words and short, clear sentences. " +
	"No rare words, no long clauses. Never write Chinese, except to quote characters that appear in the sentence or the word."

// ErrChineseReply: an English explanation was asked for and the model
// answered in Chinese.
var ErrChineseReply = errors.New("reply is in Chinese")

// IsChinese reports whether reply holds a Han character that appears in none
// of sources, the request's sentence and words: one the reply echoes from the
// page is not a Chinese answer.
func IsChinese(reply string, sources ...string) bool {
	echoed := strings.Join(sources, "")
	for _, r := range reply {
		if unicode.Is(unicode.Han, r) && !strings.ContainsRune(echoed, r) {
			return true
		}
	}
	return false
}
