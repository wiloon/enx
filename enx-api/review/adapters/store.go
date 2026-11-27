// Package adapters keeps the review domain's data in SQLite.
package adapters

import (
	"context"
	"time"

	"enx-api/review"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Store is review.Store over sqlitex.DB. It owns the review tables and, in
// user_dicts, the query count and known flag.
type Store struct{}

// Transact runs fn in one transaction. The DSN begins every transaction
// immediate, so concurrent writers run one after the other. A client that
// goes away does not cancel it: a lookup already charged is still recorded.
func (Store) Transact(ctx context.Context, fn func(review.Tx) error) error {
	return sqlitex.DB.WithContext(context.WithoutCancel(ctx)).Transaction(func(db *gorm.DB) error {
		return fn(tx{db})
	})
}

type tx struct{ db *gorm.DB }

type counts struct {
	QueryCount int
	Known      bool
}

func (t tx) Word(userID, wordID string) (int, bool, error) {
	var row counts
	err := t.db.Raw(`
		SELECT COALESCE(query_count, 0) AS query_count, COALESCE(known, 0) AS known
		FROM user_dicts WHERE user_id = ? AND word_id = ?`,
		userID, wordID).Scan(&row).Error
	return row.QueryCount, row.Known, err
}

// CountLookup starts query_count at 1 on the first lookup and adds 1 on a
// repeat; a word marked as known goes back into review without resetting the
// count. POST /api/me/word-lookups is its only user (ADR-059 Decision 3).
func (t tx) CountLookup(userID, wordID string, at time.Time) (int, bool, error) {
	var row counts
	err := t.db.Raw(`
		INSERT INTO user_dicts (user_id, word_id, query_count, known, created_at, updated_at)
		VALUES (?, ?, 1, 0, ?, ?)
		ON CONFLICT (user_id, word_id) DO UPDATE SET
			query_count = COALESCE(query_count, 0) + 1,
			known = 0,
			updated_at = excluded.updated_at
		RETURNING query_count, known`,
		userID, wordID, at.UnixMilli(), at.UnixMilli()).Scan(&row).Error
	return row.QueryCount, row.Known, err
}

// SetKnown creates a row with query_count 0 when a word with none is set
// known, and writes nothing when one with none is set not known, since no row
// already means learning with no lookups.
//
// It leaves updated_at alone: updated_at is the last lookup, which only
// CountLookup moves, so marking a word known doesn't reorder the Word List
// (ADR-027 Decision 7, 2026-10-15 note).
func (t tx) SetKnown(userID, wordID string, known bool, at time.Time) (int, bool, error) {
	var row counts
	if !known {
		err := t.db.Raw(`
			UPDATE user_dicts SET known = 0
			WHERE user_id = ? AND word_id = ?
			RETURNING query_count, known`,
			userID, wordID).Scan(&row).Error
		return row.QueryCount, row.Known, err
	}
	err := t.db.Raw(`
		INSERT INTO user_dicts (user_id, word_id, query_count, known, created_at, updated_at)
		VALUES (?, ?, 0, 1, ?, ?)
		ON CONFLICT (user_id, word_id) DO UPDATE SET
			known = 1
		RETURNING query_count, known`,
		userID, wordID, at.UnixMilli(), at.UnixMilli()).Scan(&row).Error
	return row.QueryCount, row.Known, err
}

func (t tx) State(userID, wordID string) (review.State, bool, error) {
	var rows []sqlitex.ReviewState
	err := t.db.Where("user_id = ? AND word_id = ?", userID, wordID).Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		return review.State{}, false, err
	}
	r := rows[0]
	return review.State{
		UserID: r.UserID, WordID: r.WordID,
		Stability: r.Stability, Difficulty: r.Difficulty, Phase: r.Phase,
		Due: time.UnixMilli(r.Due), LastReview: time.UnixMilli(r.LastReview),
		Reps: r.Reps, Lapses: r.Lapses,
		LastLapseAt:         timeOf(r.LastLapseAt),
		LookupRescheduledAt: timeOf(r.LookupRescheduledAt),
	}, true, nil
}

func (t tx) SaveState(s review.State) error {
	return t.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&sqlitex.ReviewState{
		UserID: s.UserID, WordID: s.WordID,
		Stability: s.Stability, Difficulty: s.Difficulty, Phase: s.Phase,
		Due: s.Due.UnixMilli(), LastReview: s.LastReview.UnixMilli(),
		Reps: s.Reps, Lapses: s.Lapses,
		LastLapseAt:         millisOf(s.LastLapseAt),
		LookupRescheduledAt: millisOf(s.LookupRescheduledAt),
	}).Error
}

func (t tx) AddLog(l review.Log) error {
	return t.db.Create(&sqlitex.ReviewLog{
		UserID: l.UserID, WordID: l.WordID, At: l.At.UnixMilli(),
		Type: string(l.Type), Source: string(l.Source), Rescheduled: l.Rescheduled,
	}).Error
}

// millisOf is t as a column that is NULL for the zero time.
func millisOf(t time.Time) *int64 {
	if t.IsZero() {
		return nil
	}
	ms := t.UnixMilli()
	return &ms
}

func timeOf(ms *int64) time.Time {
	if ms == nil {
		return time.Time{}
	}
	return time.UnixMilli(*ms)
}
