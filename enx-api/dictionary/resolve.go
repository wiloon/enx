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

// Origin is where a definition first came from (ADR-045). It is how a client
// tells an ECDICT definition from one an AI wrote.
type Origin string

const (
	OriginECDICT Origin = "ecdict"
	OriginAI     Origin = "ai"
)

// Entry is one English word's dictionary definition.
type Entry struct {
	English       string
	Chinese       string
	Pronunciation string
	// Origin is set on entries read from the WordStore; the zero value means
	// ECDICT, which is what every entry added so far is.
	Origin Origin
}

// Result is a resolved word lookup. ID is the words row id; it is empty on a
// miss, and in the rare case an ECDICT entry could not be cached.
type Result struct {
	ID            string
	English       string
	Chinese       string
	Pronunciation string
	Source        Source
	// Origin is empty on a miss.
	Origin Origin
}

// WordStore is the application's own word cache: the words table.
type WordStore interface {
	// Find returns the cached word, exact match first, then
	// case-insensitive; ok is false when it is not cached. Unless includeAI,
	// it leaves out AI-made definitions no admin has edited: those are only
	// for users who can use AI (ADR-045 Decision 6). The exclusion is the
	// store's job, so a hidden row is never read.
	Find(ctx context.Context, english string, includeAI bool) (id string, entry Entry, ok bool, err error)
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

// Entitlements says whether a user may use AI features (ADR-045 Decision 14).
type Entitlements interface {
	CanUseAI(ctx context.Context, userID string) (bool, error)
}

// Service resolves user word lookups (ADR-018's single lookup seam).
type Service struct {
	words    WordStore
	external ExternalDictionary
	meter    Meter
	ent      Entitlements
}

func NewService(words WordStore, external ExternalDictionary, meter Meter, ent Entitlements) *Service {
	return &Service{words: words, external: external, meter: meter, ent: ent}
}

// findCached reads the words table for userID. It looks first at the rows
// every user may see, which is the whole cache for nearly every lookup and
// costs no entitlement check. Only on a miss does it ask whether userID may
// use AI and, if so, look again for AI-made rows. A user who may not never
// has such a row read at all, and an entitlement error counts as "may not":
// the worst outcome is a paying user briefly not seeing an AI definition.
func (s *Service) findCached(ctx context.Context, english, userID string) (string, Entry, bool, error) {
	id, entry, ok, err := s.words.Find(ctx, english, false)
	if err != nil || ok {
		return id, entry, ok, err
	}
	canUseAI, err := s.ent.CanUseAI(ctx, userID)
	if err != nil {
		logger.Warnf("dictionary: entitlement check failed for user %s, hiding AI definitions: %v", userID, err)
		return "", Entry{}, false, nil
	}
	if !canUseAI {
		return "", Entry{}, false, nil
	}
	return s.words.Find(ctx, english, true)
}

// Resolve turns a normalized English word into its definition: the local
// words table first (AI-made definitions only for users who may use AI), then
// the external dictionary, caching an external hit in the words table. Every resolution is metered against userID's daily
// quota, whichever source answers (ADR-018 B2).
//
// Besides a WordStore read error, it returns only the sentinels
// ErrEcdictUnavailable (not cached, and no external dictionary configured)
// and ErrQuotaExceeded.
func (s *Service) Resolve(ctx context.Context, english, userID string) (Result, error) {
	id, cached, ok, err := s.findCached(ctx, english, userID)
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
			Origin:        originOrECDICT(cached.Origin),
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
		Origin:        OriginECDICT,
	}, nil
}

// originOrECDICT reads the zero Origin as ECDICT, the only origin there was
// before ADR-045.
func originOrECDICT(o Origin) Origin {
	if o == "" {
		return OriginECDICT
	}
	return o
}
