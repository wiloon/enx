// Package aitranslate provides AI-backed whole-sentence translation,
// as opposed to the dictionary-backed single-word lookups in the
// translate/dictionary packages. See docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md.
package aitranslate

import "context"

// Translator translates a single English sentence into Chinese.
type Translator interface {
	TranslateSentence(ctx context.Context, sentence string) (string, error)

	// TranslateWordInContext translates a single word into Chinese using the
	// surrounding sentence as context, so a polysemous word gets the meaning
	// it actually has in that sentence rather than a dictionary's generic
	// gloss. See docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.8.
	TranslateWordInContext(ctx context.Context, sentence, word string) (string, error)
}
