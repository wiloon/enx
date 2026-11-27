package dictionary

import (
	"cmp"
	"context"
	"slices"

	"enx-api/dictionary/wordform"
	"enx-api/utils/logger"
)

// maxSenses is the most senses an English definition carries.
const maxSenses = 10

// resolveEnglish explains english from Wiktionary alone (ADR-098): never from
// the words table or ECDICT, which hold Chinese. A miss is SourceMiss and a
// read failure SourceError; neither writes a words row.
func (s *Service) resolveEnglish(ctx context.Context, english string) (Result, error) {
	if s.wiktionary == nil || !s.wiktionary.Available() {
		return Result{}, ErrWiktionaryUnavailable
	}
	key := wordform.Key(english)
	definition, err := s.englishDefinition(ctx, key)
	switch {
	case err != nil:
		logger.Warnf("dictionary: Wiktionary read of %s failed: %v", key, err)
		return Result{English: english, Source: SourceError}, nil
	case definition == nil:
		return Result{English: english, Source: SourceMiss}, nil
	}
	return Result{
		ID:         s.wordID(ctx, english, key),
		English:    english,
		Source:     SourceWiktionary,
		Origin:     OriginWiktionary,
		Definition: definition,
	}, nil
}

// englishDefinition is nil when Wiktionary does not know key. The senses are
// the key's own, or its lemma's when it is only a form of one; the
// pronunciation is always the key's own.
func (s *Service) englishDefinition(ctx context.Context, key string) (*EnglishDefinition, error) {
	records, err := s.wiktionary.Read(ctx, key)
	if err != nil {
		return nil, err
	}
	entries, note := records.Entries, ""
	// Of several lemmas ("axes"), the first one named is the one explained.
	if i := slices.IndexFunc(records.Forms, func(f WiktionaryForm) bool { return f.LemmaKey != key }); i >= 0 {
		lemma := records.Forms[i]
		note = lemmaNote(lemma, records.Forms)
		if len(entries) > 0 {
			note = "also " + note
		} else {
			lemmaRecords, err := s.wiktionary.Read(ctx, lemma.LemmaKey)
			if err != nil {
				return nil, err
			}
			entries = lemmaRecords.Entries
		}
	}
	if len(entries) == 0 {
		return nil, nil
	}

	definition := &EnglishDefinition{LemmaNote: note}
	for _, e := range entries {
		for _, sense := range e.Senses {
			if len(definition.Senses) < maxSenses {
				definition.Senses = append(definition.Senses, Sense{POS: e.POS, Gloss: sense.Gloss, Example: sense.Example})
			}
		}
	}
	var own []IPA
	for _, e := range records.Entries {
		own = append(own, e.IPA)
	}
	for _, ipa := range append(own, records.FormIPA...) {
		definition.PronunciationUS = cmp.Or(definition.PronunciationUS, ipa.US)
		definition.PronunciationUK = cmp.Or(definition.PronunciationUK, ipa.UK)
	}
	return definition, nil
}

// lemmaNote says how a word relates to lemma, from the tags of every forms
// row naming it; the first matching rule wins.
func lemmaNote(lemma WiktionaryForm, forms []WiktionaryForm) string {
	var tags []string
	pastTense := false
	for _, f := range forms {
		if f.LemmaKey != lemma.LemmaKey {
			continue
		}
		tags = append(tags, f.Tags...)
		pastTense = pastTense || slices.Contains(f.Tags, "past") && !slices.Contains(f.Tags, "participle")
	}
	has := func(wanted ...string) bool {
		return slices.ContainsFunc(wanted, func(tag string) bool { return slices.Contains(tags, tag) })
	}
	var relation string
	switch {
	case has("misspelling"):
		relation = "misspelling"
	case has("abbreviation", "initialism", "acronym"):
		relation = "abbreviation"
	case has("alt-of", "alternative"):
		relation = "alternative form"
	case has("third-person"):
		relation = "third-person singular"
	case has("plural"):
		relation = "plural"
	case pastTense:
		relation = "past tense"
	case has("past") && has("participle"):
		relation = "past participle"
	case has("gerund") || has("present") && has("participle"):
		relation = "present participle"
	case has("comparative"):
		relation = "comparative"
	case has("superlative"):
		relation = "superlative"
	default:
		relation = "form"
	}
	return relation + " of " + lemma.Lemma
}

// wordID gives a Wiktionary hit its words row (ADR-098 Decision 5): the
// clicked word's live row, else the row ECDICT's answer creates, else one with
// no Chinese under key. It is empty when no row can be read or stored.
func (s *Service) wordID(ctx context.Context, english, key string) string {
	id, ok, err := s.words.ID(ctx, english)
	if err != nil {
		logger.Warnf("dictionary: could not read the row of %s: %v", english, err)
		return ""
	}
	if ok {
		return id
	}
	entry := Entry{English: key, Origin: OriginWiktionary}
	if s.external.Available() {
		found, err := s.external.Lookup(ctx, english)
		if err == nil {
			entry = found
		}
	}
	id, err = s.words.Add(ctx, entry)
	if err != nil {
		logger.Errorf("dictionary: could not cache %s: %v", entry.English, err)
		return ""
	}
	return id
}
