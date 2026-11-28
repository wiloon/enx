package dictionary

import (
	"context"

	"enx-api/utils/logger"
)

// EnglishAIRow is one shared English-English AI definition (ADR-098 Decision 5).
// word_id points at words.id; senses match the Wiktionary Sense shape.
type EnglishAIRow struct {
	WordID        string
	Senses        []Sense
	Quality       int
	PromptVersion string
}

// EnglishAIStore is the ai_english_definitions table: shared across every
// user who may use AI, whatever the quality score. A second insert for the
// same word_id keeps the first row.
type EnglishAIStore interface {
	Find(ctx context.Context, wordID string) (EnglishAIRow, bool, error)
	// Insert writes row. On conflict with an existing word_id it keeps that
	// row and returns inserted=false.
	Insert(ctx context.Context, row EnglishAIRow) (inserted bool, err error)
}

// UseEnglishAI wires the shared English AI definitions table. Without it a
// Wiktionary miss stays a miss on the first lookup.
func (s *Service) UseEnglishAI(store EnglishAIStore) {
	s.englishAI = store
}

// findEnglishAI is the first-lookup read of a stored English AI row
// (ADR-098 Decision 5 / ADR-079 Decision 2 for Chinese): only when CanUseAI
// is true; NoUser or an entitlement error hides the row (the result stays a
// miss); a table read failure is SourceError. The read writes nothing.
func (s *Service) findEnglishAI(ctx context.Context, english, key, userID string) (Result, bool, error) {
	if s.englishAI == nil || userID == NoUser {
		return Result{}, false, nil
	}
	canUse, err := s.ent.CanUseAI(ctx, userID)
	if err != nil {
		logger.Warnf("dictionary: entitlement check failed for user %s, hiding English AI definitions: %v", userID, err)
		return Result{}, false, nil
	}
	if !canUse {
		return Result{}, false, nil
	}
	wordID, err := s.existingWordID(ctx, english, key)
	if err != nil {
		logger.Warnf("dictionary: English AI read of %s failed: %v", english, err)
		return Result{English: english, Source: SourceError}, true, nil
	}
	if wordID == "" {
		return Result{}, false, nil
	}
	row, ok, err := s.englishAI.Find(ctx, wordID)
	if err != nil {
		logger.Warnf("dictionary: English AI read of word_id %s failed: %v", wordID, err)
		return Result{English: english, Source: SourceError}, true, nil
	}
	if !ok {
		return Result{}, false, nil
	}
	return Result{
		ID:         wordID,
		English:    english,
		Source:     SourceLocal,
		Origin:     OriginAI,
		Definition: &EnglishDefinition{Senses: row.Senses},
	}, true, nil
}

// existingWordID is the words row the English AI write would choose, without
// creating one: the clicked word's live row, else the row spelled as ECDICT's
// answer, else the key. "" means no such row; a failed words read is an error,
// so a stored definition is never taken for a miss.
func (s *Service) existingWordID(ctx context.Context, english, key string) (string, error) {
	id, ok, err := s.words.ID(ctx, english)
	if err != nil || ok {
		return id, err
	}
	if s.external.Available() {
		found, err := s.external.Lookup(ctx, english)
		if err == nil {
			id, ok, err = s.words.ID(ctx, found.English)
			if err != nil || ok {
				return id, err
			}
		}
	}
	id, _, err = s.words.ID(ctx, key)
	return id, err
}
