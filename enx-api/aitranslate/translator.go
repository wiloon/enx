// Package aitranslate provides AI-backed whole-sentence translation,
// as opposed to the dictionary-backed single-word lookups in the
// translate/dictionary packages. See docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md.
package aitranslate

import (
	"context"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/sentenceword"
)

// Usage re-exports aiusage.Usage so code in this package doesn't need the
// leaf import. The leaf package exists only to break the
// aitranslate <-> provider import cycle (see the aiusage package doc).
type Usage = aiusage.Usage

// Translator translates English into Chinese via an AI provider. Every
// method also returns the call's token Usage so the handler can bill by
// actual consumption (ADR-014).
type Translator interface {
	TranslateSentence(ctx context.Context, sentence string) (string, Usage, error)

	// TranslateWordInContext translates a single word into Chinese using the
	// surrounding sentence as context, so a polysemous word gets the meaning
	// it actually has in that sentence rather than a dictionary's generic
	// gloss. See docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.8.
	TranslateWordInContext(ctx context.Context, sentence, word string) (string, Usage, error)

	// TranslateSentenceWithWord does both of the above in ONE LLM call
	// (ADR-014): the whole-sentence translation plus `word`'s meaning in
	// that sentence's context, used when the Side Panel is opened from a
	// word click. Result.WordChinese may be empty if the model omitted it --
	// the caller falls back to a separate word-in-context call rather than
	// failing.
	TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, Usage, error)
}
