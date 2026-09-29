package dictionary

import (
	"context"

	"enx-api/dictsample"
	"enx-api/enx"
	"enx-api/repo"
	"enx-api/utils/logger"
)

// Source names where a resolved lookup's definition came from.
type Source string

const (
	SourceLocal  Source = "local"  // the words table
	SourceEcdict Source = "ecdict" // ECDICT, now cached in the words table
	SourceMiss   Source = "miss"   // neither knows the word
)

// Result is a resolved word lookup. ID is the words row id; it is empty on a
// miss, and in the rare case an ECDICT entry could not be cached.
type Result struct {
	ID            string
	English       string
	Chinese       string
	Pronunciation string
	Source        Source
}

// Resolve turns a normalized English word into its definition: the local
// words table first, then ECDICT, caching an ECDICT hit in the words table
// (ADR-018 A2's deep seam). Every resolution is metered against userID's
// daily quota, whichever source answers (ADR-018 B2).
//
// It returns only the sentinels ErrEcdictUnavailable (not cached and ECDICT
// is not configured) and ErrQuotaExceeded.
func Resolve(ctx context.Context, english, userID string) (Result, error) {
	if w := repo.GetWordByEnglish(english); w.Id != "" {
		if err := MeterLookup(ctx, userID); err != nil {
			return Result{}, err
		}
		// ADR-030 Decision 0 ②: a local hit belongs in the miss-rate
		// denominator too.
		dictsample.Word(english, dictsample.SourceLocal)
		return Result{
			ID:            w.Id,
			English:       english,
			Chinese:       w.Chinese,
			Pronunciation: w.Pronunciation,
			Source:        SourceLocal,
		}, nil
	}

	entry, err := lookupEcdict(ctx, english, userID)
	if err != nil {
		return Result{}, err
	}
	if entry == nil {
		return Result{English: english, Source: SourceMiss}, nil
	}
	return Result{
		ID:            cacheWord(entry),
		English:       entry.English,
		Chinese:       entry.Chinese,
		Pronunciation: entry.Pronunciation,
		Source:        SourceEcdict,
	}, nil
}

// cacheWord stores an ECDICT entry in the words table and returns its id.
// The headword may already be cached -- an inflection resolved to it ("ran"
// -> "run"), or a concurrent lookup inserted it first -- and then that row
// is reused. Returns "" if the word could not be persisted.
func cacheWord(entry *enx.Dictionary) string {
	w := enx.Word{
		English:       entry.English,
		Chinese:       entry.Chinese,
		Pronunciation: entry.Pronunciation,
	}
	if err := w.Save(); err != nil {
		w.FindId()
		if w.Id == "" {
			logger.Errorf("dictionary: could not cache %s: %v", entry.English, err)
		}
	}
	return w.Id
}
