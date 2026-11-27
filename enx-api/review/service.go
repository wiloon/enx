// Package review is the review domain (ADR-097): each user's FSRS schedule
// per word (review state) and the memory signals behind it (review logs).
package review

import (
	"context"
	"time"
)

// RescheduleWindow is how long after a lookup that rescheduled a word another
// lookup of it does not (ADR-097 Decision 4): clicks on the same word while
// reading one article are one failure to recall it.
const RescheduleWindow = time.Hour

// Source is where a memory signal came from.
type Source string

const (
	SourcePopover  Source = "popover"
	SourceWordList Source = "word_list"
	SourceUnknown  Source = "unknown"
)

// ParseSource reads the source a client sends with a lookup or Know it. A
// client that sends none, or anything else, is SourceUnknown.
func ParseSource(raw string) Source {
	switch source := Source(raw); source {
	case SourcePopover, SourceWordList:
		return source
	}
	return SourceUnknown
}

// Signal is a review log row's type.
type Signal string

const (
	SignalLookup      Signal = "lookup"
	SignalLapseLookup Signal = "lookup_lapse"
	SignalKnow        Signal = "know"
	SignalUnknow      Signal = "unknow"
)

// State is one user's review state for one word. Phase is go-fsrs's card
// state.
type State struct {
	UserID     string
	WordID     string
	Stability  float64
	Difficulty float64
	Phase      int
	Due        time.Time
	LastReview time.Time
	Reps       int
	// Lapses counts the known words looked up again (ADR-097 Decision 5),
	// not go-fsrs's Card.Lapses.
	Lapses      int
	LastLapseAt time.Time // zero: none
	// LookupRescheduledAt is the last lookup that rescheduled the word,
	// which is what RescheduleWindow runs from; zero: none.
	LookupRescheduledAt time.Time
}

// Log is one memory signal.
type Log struct {
	UserID string
	WordID string
	At     time.Time
	Type   Signal
	Source Source
	// Rescheduled is set on lookups only.
	Rescheduled *bool
}

// Tx reads and writes one user's word inside a transaction.
type Tx interface {
	// Word is the user's query count and known flag for the word; zero and
	// false when the user has never looked it up or marked it.
	Word(userID, wordID string) (queryCount int, known bool, err error)
	// CountLookup raises the query count by one and clears the known flag.
	CountLookup(userID, wordID string, at time.Time) (queryCount int, known bool, err error)
	// SetKnown sets the known flag. Setting a word not known that the user
	// has never looked up or marked writes nothing.
	SetKnown(userID, wordID string, known bool, at time.Time) (queryCount int, isKnown bool, err error)
	State(userID, wordID string) (state State, found bool, err error)
	SaveState(state State) error
	AddLog(entry Log) error
}

// Store runs fn in one write transaction: everything fn wrote is kept when it
// returns nil and none of it otherwise, and no other writer comes between its
// reads and its writes.
type Store interface {
	Transact(ctx context.Context, fn func(Tx) error) error
}

// Service records memory signals.
type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store, now func() time.Time) *Service {
	return &Service{store: store, now: now}
}

// RecordLookup records one click-to-lookup and returns the query count and
// known flag it leaves. The lookup always counts, puts a known word back into
// review and writes a log row. It reschedules the word as Again unless an
// earlier lookup did so inside RescheduleWindow; a lookup of a known word is a
// lapse and always reschedules (ADR-097 Decisions 4 and 5).
func (s *Service) RecordLookup(ctx context.Context, userID, wordID, source string) (queryCount int, known bool, err error) {
	at := s.now()
	err = s.store.Transact(ctx, func(tx Tx) error {
		_, lapse, err := tx.Word(userID, wordID)
		if err != nil {
			return err
		}
		if queryCount, known, err = tx.CountLookup(userID, wordID, at); err != nil {
			return err
		}
		state, found, err := tx.State(userID, wordID)
		if err != nil {
			return err
		}
		entry := Log{UserID: userID, WordID: wordID, At: at, Type: SignalLookup, Source: ParseSource(source)}
		if lapse {
			entry.Type = SignalLapseLookup
		}
		reschedule := lapse || !found || at.Sub(state.LookupRescheduledAt) >= RescheduleWindow
		entry.Rescheduled = &reschedule
		if reschedule {
			state.UserID, state.WordID = userID, wordID
			state = again(state, at)
			state.LookupRescheduledAt = at
			if lapse {
				state.Lapses++
				state.LastLapseAt = at
			}
			if err := tx.SaveState(state); err != nil {
				return err
			}
		}
		return tx.AddLog(entry)
	})
	if err != nil {
		return 0, false, err
	}
	return queryCount, known, nil
}

// SetKnown marks or unmarks a word known. Only an actual change writes a log
// row, so a retried request writes none; the review state is left as it is.
func (s *Service) SetKnown(ctx context.Context, userID, wordID string, known bool, source string) (queryCount int, isKnown bool, err error) {
	at := s.now()
	err = s.store.Transact(ctx, func(tx Tx) error {
		_, was, err := tx.Word(userID, wordID)
		if err != nil {
			return err
		}
		if queryCount, isKnown, err = tx.SetKnown(userID, wordID, known, at); err != nil {
			return err
		}
		if was == isKnown {
			return nil
		}
		entry := Log{UserID: userID, WordID: wordID, At: at, Type: SignalUnknow, Source: ParseSource(source)}
		if isKnown {
			entry.Type = SignalKnow
		}
		return tx.AddLog(entry)
	})
	if err != nil {
		return 0, false, err
	}
	return queryCount, isKnown, nil
}
