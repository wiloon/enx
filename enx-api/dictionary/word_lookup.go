package dictionary

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/stats"
	"enx-api/utils/logger"
)

// ErrWordNotFound: the word id names no word.
var ErrWordNotFound = errors.New("dictionary: word not found")

// WordLookupRecords is whether a word exists to record a lookup of.
type WordLookupRecords interface {
	WordExists(ctx context.Context, wordID string) (bool, error)
}

// LookupReviews is the review system's record of a lookup (ADR-097).
type LookupReviews interface {
	// RecordLookup raises userID's query count for wordID by one, updates
	// its review schedule and returns the new count and known flag. source
	// is where the client says the lookup came from; any value is accepted.
	RecordLookup(ctx context.Context, userID, wordID, source string) (queryCount int, known bool, err error)
}

// WordLookups records one click-to-lookup (ADR-059 Decision 3, ADR-079
// Decision 1): the only writer of lookup events and query counts.
type WordLookups struct {
	records WordLookupRecords
	reviews LookupReviews
	meter   Meter
	events  LookupEventStore
	now     func() time.Time
}

func NewWordLookups(records WordLookupRecords, reviews LookupReviews, meter Meter, events LookupEventStore, now func() time.Time) *WordLookups {
	return &WordLookups{records: records, reviews: reviews, meter: meter, events: events, now: now}
}

// Record charges one lookup against userID's daily quota, records it with the
// review system (which raises their query count for wordID by one) and writes
// one lookup event, in that order.
//
// A word that does not exist is ErrWordNotFound and not charged. An
// over-quota lookup is ErrQuotaExceeded: no count, no event. Any other meter
// error fails open (ADR-029 E2). A count that fails after the charge leaves
// the charge standing and writes no event. A failed event write is only
// logged: the lookup was counted, and the stats are one short.
func (w *WordLookups) Record(ctx context.Context, userID, wordID, source string) (queryCount int, known bool, err error) {
	exists, err := w.records.WordExists(ctx, wordID)
	if err != nil {
		return 0, false, fmt.Errorf("find word %s: %w", wordID, err)
	}
	if !exists {
		return 0, false, ErrWordNotFound
	}
	if err := w.meter.Charge(ctx, userID, 1); errors.Is(err, ErrQuotaExceeded) {
		return 0, false, err
	} else if err != nil {
		logger.Warnf("dictionary: lookup quota charge failed for user %s, allowing lookup: %v", userID, err)
	}
	queryCount, known, err = w.reviews.RecordLookup(ctx, userID, wordID, source)
	if err != nil {
		return 0, false, err
	}
	err = w.events.Add(ctx, LookupEvent{
		UserID:          userID,
		At:              w.now().UTC(),
		TZOffsetMinutes: stats.OffsetFromContext(ctx),
		Outcome:         OutcomeAllowed,
	})
	if err != nil {
		logger.Warnf("dictionary: lookup event write failed for user %s: %v", userID, err)
	}
	return queryCount, known, nil
}
