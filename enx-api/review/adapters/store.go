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

func (t tx) LiveWord(wordID string) (bool, error) {
	var n int64
	err := t.db.Raw(`SELECT COUNT(1) FROM words WHERE id = ? AND deleted_at IS NULL`, wordID).Scan(&n).Error
	return n > 0, err
}

// Schedules lists every live word the user has a user_dicts row for, with its
// review state when present. Candidates filters and orders them.
func (Store) Schedules(ctx context.Context, userID string) ([]review.ScheduleRow, error) {
	type row struct {
		WordID              string
		English             string
		Known               bool
		QueryCount          int
		UpdatedAt           int64
		HasState            bool
		Stability           float64
		Difficulty          float64
		Phase               int
		Due                 *int64
		LastReview          *int64
		Reps                int
		Lapses              int
		LastLapseAt         *int64
		LookupRescheduledAt *int64
	}
	var rows []row
	err := sqlitex.DB.WithContext(ctx).Raw(`
		SELECT ud.word_id AS word_id, w.english AS english,
			COALESCE(ud.known, 0) AS known, COALESCE(ud.query_count, 0) AS query_count,
			ud.updated_at AS updated_at,
			rs.word_id IS NOT NULL AS has_state,
			COALESCE(rs.stability, 0) AS stability, COALESCE(rs.difficulty, 0) AS difficulty,
			COALESCE(rs.phase, 0) AS phase, rs.due AS due, rs.last_review AS last_review,
			COALESCE(rs.reps, 0) AS reps, COALESCE(rs.lapses, 0) AS lapses,
			rs.last_lapse_at AS last_lapse_at, rs.lookup_rescheduled_at AS lookup_rescheduled_at
		FROM user_dicts ud
		JOIN words w ON w.id = ud.word_id AND w.deleted_at IS NULL
		LEFT JOIN review_states rs ON rs.user_id = ud.user_id AND rs.word_id = ud.word_id
		WHERE ud.user_id = ?`, userID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]review.ScheduleRow, len(rows))
	for i, r := range rows {
		out[i] = review.ScheduleRow{
			WordID: r.WordID, English: r.English, Known: r.Known,
			QueryCount: r.QueryCount, UpdatedAt: time.UnixMilli(r.UpdatedAt),
		}
		if r.HasState && r.Due != nil && r.LastReview != nil {
			st := review.State{
				UserID: userID, WordID: r.WordID,
				Stability: r.Stability, Difficulty: r.Difficulty, Phase: r.Phase,
				Due: time.UnixMilli(*r.Due), LastReview: time.UnixMilli(*r.LastReview),
				Reps: r.Reps, Lapses: r.Lapses,
				LastLapseAt: timeOf(r.LastLapseAt), LookupRescheduledAt: timeOf(r.LookupRescheduledAt),
			}
			out[i].State = &st
		}
	}
	return out, nil
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
