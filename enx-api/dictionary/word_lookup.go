package dictionary

import (
	"context"
	"errors"
	"fmt"

	"enx-api/utils/logger"
)

// ErrWordNotFound: the word id names no word.
var ErrWordNotFound = errors.New("dictionary: word not found")

// QueryCounts is the review system's per-user query counts (user_dicts) and
// the words they count.
type QueryCounts interface {
	WordExists(ctx context.Context, wordID string) (bool, error)
	// RecordWordLookup raises userID's query count for wordID by one and
	// returns the new count and known flag.
	RecordWordLookup(ctx context.Context, userID, wordID string) (queryCount int, known bool, err error)
}

// WordLookups records one click-to-lookup against a user's query count
// (ADR-059 Decision 3).
type WordLookups struct {
	counts QueryCounts
	meter  Meter
}

func NewWordLookups(counts QueryCounts, meter Meter) *WordLookups {
	return &WordLookups{counts: counts, meter: meter}
}

// Record raises userID's query count for wordID by one.
//
// A lookup the extension answered from its local dictionary cache
// (fromCache) sent no lookup GET, so this click is charged here instead
// (ADR-061 Decision 4). The charge comes after the existence check -- the
// extension answers ErrWordNotFound with a fresh GET, which charges the
// click -- and before the count: an over-quota click returns
// ErrQuotaExceeded and leaves the count alone. Like the GET, it fails open
// (ADR-029 E2) on any meter error but the quota. A count that fails after
// the charge leaves the charge standing, as a lost POST after a GET does.
func (w *WordLookups) Record(ctx context.Context, userID, wordID string, fromCache bool) (queryCount int, known bool, err error) {
	exists, err := w.counts.WordExists(ctx, wordID)
	if err != nil {
		return 0, false, fmt.Errorf("find word %s: %w", wordID, err)
	}
	if !exists {
		return 0, false, ErrWordNotFound
	}
	if fromCache {
		if err := w.meter.Charge(ctx, userID); errors.Is(err, ErrQuotaExceeded) {
			return 0, false, err
		} else if err != nil {
			logger.Warnf("dictionary: lookup quota charge failed for user %s, allowing lookup: %v", userID, err)
		}
	}
	return w.counts.RecordWordLookup(ctx, userID, wordID)
}
