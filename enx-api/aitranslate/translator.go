// Package aitranslate provides AI-backed whole-sentence translation,
// as opposed to the dictionary-backed single-word lookups in the
// translate/dictionary packages. See docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md.
package aitranslate

import "context"

// Translator translates a single English sentence into Chinese.
type Translator interface {
	TranslateSentence(ctx context.Context, sentence string) (string, error)
}
