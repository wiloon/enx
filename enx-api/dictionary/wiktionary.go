package dictionary

import "context"

// Wiktionary is the English-English dictionary consulted when the explanation
// language is English (ADR-098). A layer of admin corrections (#1231) can sit
// in front of the file without Resolve changing.
type Wiktionary interface {
	Available() bool
	// Read returns what the dictionary holds under key (wordform.Key); all of
	// it is empty for a key it does not know.
	Read(ctx context.Context, key string) (WiktionaryRecords, error)
}

// WiktionaryRecords is what a Wiktionary holds under one key.
type WiktionaryRecords struct {
	Entries []WiktionaryEntry // in display order
	// Forms says which lemmas the key is an inflection or alternative form
	// of, in the dictionary's order.
	Forms []WiktionaryForm
	// FormIPA is the key's own pronunciation where it has no entry.
	FormIPA []IPA
	// LemmaPreferred says the key has entries but is known only as a form, so
	// its lemma's senses are shown instead.
	LemmaPreferred bool
}

// IPA is a pronunciation, American and British; either may be empty.
type IPA struct {
	US, UK string
}

type WiktionaryEntry struct {
	POS    string
	IPA    IPA
	Senses []WiktionarySense
}

type WiktionarySense struct {
	Gloss   string
	Example string // empty when the sense has none
}

type WiktionaryForm struct {
	Lemma, LemmaKey string
	Tags            []string
}

// Sense is one English definition of a word.
type Sense struct {
	POS, Gloss, Example string
}

// EnglishDefinition is how a word is explained in English.
type EnglishDefinition struct {
	Senses []Sense
	// LemmaNote says what the word is an inflection or alternative form of
	// ("past tense of go"); empty when it is neither.
	LemmaNote                        string
	PronunciationUS, PronunciationUK string
}
