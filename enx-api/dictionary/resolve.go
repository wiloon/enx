package dictionary

import (
	"context"
	"errors"

	"enx-api/dictsample"
	"enx-api/utils/logger"
)

// Source names where a resolved lookup's definition came from.
type Source string

const (
	SourceLocal   Source = "local"   // the words table
	SourceEcdict  Source = "ecdict"  // ECDICT, now cached in the words table
	SourceMiss    Source = "miss"    // neither knows the word
	SourceTimeout Source = "timeout" // ECDICT gave up before answering
	SourceError   Source = "error"   // ECDICT failed, or the caller gave up
)

var (
	// ErrNotInDictionary: the external dictionary answered, and it doesn't
	// know the word.
	ErrNotInDictionary = errors.New("dictionary: word not in the external dictionary")
	// ErrExternalTimeout: the external dictionary gave up before answering.
	ErrExternalTimeout = errors.New("dictionary: external dictionary timed out")
)

// Entry is one English word's dictionary definition.
type Entry struct {
	English       string
	Chinese       string
	Pronunciation string
}

// Result is a resolved word lookup. ID is the words row id; it is empty on a
// miss, and in the rare case an ECDICT entry could not be cached.
type Result struct {
	ID            string
	English       string
	Chinese       string
	Pronunciation string
	Source        Source
}

// WordStore is the application's own word cache: the words table.
type WordStore interface {
	// Find returns the cached word, exact match first, then
	// case-insensitive; ok is false when it is not cached.
	Find(ctx context.Context, english string) (id string, entry Entry, ok bool, err error)
	// Add caches entry and returns its id. When entry.English is already
	// cached -- an inflection resolved to a cached headword ("ran" ->
	// "run"), or a concurrent lookup added it first -- it returns the
	// existing row's id.
	Add(ctx context.Context, entry Entry) (id string, err error)
}

// ExternalDictionary is a read-only dictionary consulted when the WordStore
// misses. ECDICT today; ADR-030's provider chain adds more.
type ExternalDictionary interface {
	Available() bool
	// Lookup resolves english, possibly to its headword (Entry.English). It
	// returns ErrNotInDictionary when the dictionary doesn't know the word,
	// ErrExternalTimeout when it gave up, or any other error when it failed.
	Lookup(ctx context.Context, english string) (Entry, error)
}

// Meter charges one lookup against a user's daily quota (ADR-018 B2,
// ADR-029). It returns ErrQuotaExceeded or nil.
type Meter interface {
	Charge(ctx context.Context, userID string) error
}

// Service resolves user word lookups (ADR-018's single lookup seam).
type Service struct {
	words    WordStore
	external ExternalDictionary
	meter    Meter
}

func NewService(words WordStore, external ExternalDictionary, meter Meter) *Service {
	return &Service{words: words, external: external, meter: meter}
}

// Resolve turns a normalized English word into its definition: the local
// words table first, then the external dictionary, caching an external hit
// in the words table. Every resolution is metered against userID's daily
// quota, whichever source answers (ADR-018 B2).
//
// Besides a WordStore read error, it returns only the sentinels
// ErrEcdictUnavailable (not cached, and no external dictionary configured)
// and ErrQuotaExceeded.
func (s *Service) Resolve(ctx context.Context, english, userID string) (Result, error) {
	id, cached, ok, err := s.words.Find(ctx, english)
	if err != nil {
		return Result{}, err
	}
	if ok {
		if err := s.meter.Charge(ctx, userID); err != nil {
			return Result{}, err
		}
		// ADR-030 Decision 0 ②: a local hit belongs in the miss-rate
		// denominator too.
		dictsample.Word(english, dictsample.SourceLocal)
		return Result{
			ID:            id,
			English:       english,
			Chinese:       cached.Chinese,
			Pronunciation: cached.Pronunciation,
			Source:        SourceLocal,
		}, nil
	}

	if !s.external.Available() {
		return Result{}, ErrEcdictUnavailable
	}
	if err := s.meter.Charge(ctx, userID); err != nil {
		return Result{}, err
	}
	entry, err := s.external.Lookup(ctx, english)
	switch {
	case errors.Is(err, ErrNotInDictionary):
		dictsample.Word(english, dictsample.SourceNone)
		return Result{English: english, Source: SourceMiss}, nil
	case errors.Is(err, ErrExternalTimeout):
		// No definition for the user, as for a miss; labelled apart so the
		// miss rate measures dictionary coverage only (ADR-040).
		return Result{English: english, Source: SourceTimeout}, nil
	case err != nil:
		logger.Warnf("dictionary: external lookup of %s failed: %v", english, err)
		return Result{English: english, Source: SourceError}, nil
	}
	dictsample.Word(english, dictsample.SourceEcdict)

	id, err = s.words.Add(ctx, entry)
	if err != nil {
		// Still answer with the definition; the caller skips the review
		// bookkeeping, which needs a persisted word id.
		logger.Errorf("dictionary: could not cache %s: %v", entry.English, err)
		id = ""
	}
	return Result{
		ID:            id,
		English:       entry.English,
		Chinese:       entry.Chinese,
		Pronunciation: entry.Pronunciation,
		Source:        SourceEcdict,
	}, nil
}
