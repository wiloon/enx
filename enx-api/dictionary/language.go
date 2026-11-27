package dictionary

import (
	"context"
	"errors"
)

// Language is the explanation language: the language word definitions are
// given in (ADR-098).
type Language string

const (
	LanguageZhHans  Language = "zh-Hans"
	LanguageEnglish Language = "en"
)

// ErrWiktionaryUnavailable: an English explanation was asked for and there is
// no Wiktionary dictionary to read it from.
var ErrWiktionaryUnavailable = errors.New("dictionary: Wiktionary unavailable")

// ExplanationLanguages reads the language a user wants explanations in.
type ExplanationLanguages interface {
	ExplanationLanguage(ctx context.Context, userID string) (Language, error)
}
