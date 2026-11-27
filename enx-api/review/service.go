// Package review is the review domain (ADR-097): each user's FSRS schedule
// per word (review state) and the memory signals behind it (review logs).
package review

import (
	"context"
	"errors"
	"sort"
	"time"
)

// RescheduleWindow is how long after a lookup that rescheduled a word another
// lookup of it does not (ADR-097 Decision 4): clicks on the same word while
// reading one article are one failure to recall it.
const RescheduleWindow = time.Hour

// SessionLimit is how many cards one session returns (ADR-097 Decision 2).
const SessionLimit = 20

// Source is where a memory signal came from.
type Source string

const (
	SourcePopover  Source = "popover"
	SourceWordList Source = "word_list"
	SourceReview   Source = "review"
	SourceUnknown  Source = "unknown"
)

// ParseSource reads the source a client sends with a lookup or Know it. A
// client that sends none, or anything else, is SourceUnknown. SourceReview is
// only set by the answer endpoint, never accepted from a client here.
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
	SignalAgain       Signal = "again"
	SignalHard        Signal = "hard"
	SignalGood        Signal = "good"
	SignalEasy        Signal = "easy"
)

// Rating is one of the four FSRS answers on a review card.
type Rating string

const (
	RatingAgain Rating = "again"
	RatingHard  Rating = "hard"
	RatingGood  Rating = "good"
	RatingEasy  Rating = "easy"
)

// ParseRating reads a client rating. An empty or unknown value is invalid.
func ParseRating(raw string) (Rating, bool) {
	switch r := Rating(raw); r {
	case RatingAgain, RatingHard, RatingGood, RatingEasy:
		return r, true
	}
	return "", false
}

var (
	// ErrNotDue: the word is not a session candidate right now (known, never
	// looked up, or has a state that is not due).
	ErrNotDue = errors.New("review: word is not due")
	// ErrWordGone: wordID names no live words row.
	ErrWordGone = errors.New("review: word not found")
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
	// LiveWord reports whether wordID is a live words row.
	LiveWord(wordID string) (found bool, err error)
}

// ScheduleRow is one of the user's words and its review state, used to build
// a session. UpdatedAt is the last lookup (user_dicts.updated_at).
type ScheduleRow struct {
	WordID     string
	English    string
	Known      bool
	QueryCount int
	UpdatedAt  time.Time
	// State is nil when the word has no review state yet.
	State *State
}

// Candidate is one word a session may show.
type Candidate struct {
	WordID  string
	English string
}

// Store runs fn in one write transaction: everything fn wrote is kept when it
// returns nil and none of it otherwise, and no other writer comes between its
// reads and its writes. Schedules lists the facts Candidates needs.
type Store interface {
	Transact(ctx context.Context, fn func(Tx) error) error
	Schedules(ctx context.Context, userID string) ([]ScheduleRow, error)
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

// Candidates returns up to limit session cards for userID: due words most
// overdue first, then review-list words with no state, most recently looked
// up first. Known words and states that are not due are excluded.
func (s *Service) Candidates(ctx context.Context, userID string, limit int) ([]Candidate, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.store.Schedules(ctx, userID)
	if err != nil {
		return nil, err
	}
	return selectCandidates(rows, s.now(), limit), nil
}

// Answer records one FSRS rating for wordID. The word must be a session
// candidate right now (the session's 20-card cap aside). A candidate with no
// state is learned as a new card. Source is always review.
func (s *Service) Answer(ctx context.Context, userID, wordID string, rating Rating) (due time.Time, err error) {
	at := s.now()
	err = s.store.Transact(ctx, func(tx Tx) error {
		live, err := tx.LiveWord(wordID)
		if err != nil {
			return err
		}
		if !live {
			return ErrWordGone
		}
		queryCount, known, err := tx.Word(userID, wordID)
		if err != nil {
			return err
		}
		state, found, err := tx.State(userID, wordID)
		if err != nil {
			return err
		}
		if !isCandidate(known, queryCount, found, state, at) {
			return ErrNotDue
		}
		state.UserID, state.WordID = userID, wordID
		state = schedule(state, at, rating)
		if err := tx.SaveState(state); err != nil {
			return err
		}
		due = state.Due
		return tx.AddLog(Log{
			UserID: userID, WordID: wordID, At: at,
			Type: signalOf(rating), Source: SourceReview,
		})
	})
	if err != nil {
		return time.Time{}, err
	}
	return due, nil
}

func signalOf(rating Rating) Signal {
	switch rating {
	case RatingHard:
		return SignalHard
	case RatingGood:
		return SignalGood
	case RatingEasy:
		return SignalEasy
	default:
		return SignalAgain
	}
}

// isCandidate is whether the word may be answered (and shown) right now.
func isCandidate(known bool, queryCount int, hasState bool, state State, now time.Time) bool {
	if known {
		return false
	}
	if hasState {
		return !state.Due.After(now)
	}
	return queryCount > 0
}

func selectCandidates(rows []ScheduleRow, now time.Time, limit int) []Candidate {
	var due, fresh []ScheduleRow
	for _, row := range rows {
		if row.Known {
			continue
		}
		if row.State != nil {
			if !row.State.Due.After(now) {
				due = append(due, row)
			}
			continue
		}
		if row.QueryCount > 0 {
			fresh = append(fresh, row)
		}
	}
	sort.SliceStable(due, func(i, j int) bool {
		return due[i].State.Due.Before(due[j].State.Due)
	})
	sort.SliceStable(fresh, func(i, j int) bool {
		return fresh[i].UpdatedAt.After(fresh[j].UpdatedAt)
	})

	out := make([]Candidate, 0, limit)
	for _, row := range due {
		if len(out) >= limit {
			return out
		}
		out = append(out, Candidate{WordID: row.WordID, English: row.English})
	}
	for _, row := range fresh {
		if len(out) >= limit {
			return out
		}
		out = append(out, Candidate{WordID: row.WordID, English: row.English})
	}
	return out
}
