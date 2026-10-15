// Package wordlist reads back a user's word list: every word they have looked
// up in an article (a user_dicts row), including the ones since marked known.
// Rows are written by the lookup path (repo.RecordWordLookup) and by marking a
// word known (POST /api/mark); this package only reads them or removes them.
package wordlist

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"enx-api/utils/sqlitex"
)

// Status filters the list by the user's familiarity flag.
type Status string

const (
	StatusAll      Status = "all"
	StatusLearning Status = "learning" // already_acquainted = 0
	StatusKnown    Status = "known"    // already_acquainted = 1
)

// ErrInvalidStatus is returned by ParseStatus for anything but the three
// statuses above.
var ErrInvalidStatus = errors.New("wordlist: invalid status")

// ParseStatus reads a status query parameter; empty means StatusAll.
func ParseStatus(s string) (Status, error) {
	switch Status(s) {
	case "", StatusAll:
		return StatusAll, nil
	case StatusLearning, StatusKnown:
		return Status(s), nil
	}
	return "", ErrInvalidStatus
}

// Sort orders the list.
type Sort string

const (
	SortRecent  Sort = "recent"  // last looked up first
	SortLookups Sort = "lookups" // most looked up first, then last looked up
)

// ErrInvalidSort is returned by ParseSort for anything but the two sorts
// above.
var ErrInvalidSort = errors.New("wordlist: invalid sort")

// ParseSort reads a sort query parameter; empty means SortRecent.
func ParseSort(s string) (Sort, error) {
	switch Sort(s) {
	case "", SortRecent:
		return SortRecent, nil
	case SortLookups:
		return SortLookups, nil
	}
	return "", ErrInvalidSort
}

const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// Query is one page of the list. Search matches the start of the word, in any
// case.
type Query struct {
	Status Status
	Search string
	Sort   Sort
	Limit  int
	Offset int
}

func (q Query) normalize() Query {
	if q.Limit <= 0 {
		q.Limit = DefaultLimit
	}
	if q.Limit > MaxLimit {
		q.Limit = MaxLimit
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	return q
}

// Entry is one word on the list.
//
// LastLookedUpAt is user_dicts.updated_at, which only a lookup moves; marking
// a word known leaves it alone (ADR-027 Decision 7, 2026-10-15 note). Rows
// marked known before that date may carry the time of the mark instead.
type Entry struct {
	English         string
	Chinese         string
	Pronunciation   string
	QueryCount      int
	Known           bool
	FirstLookedUpAt time.Time
	LastLookedUpAt  time.Time
}

// Page is a slice of the list plus the size of the whole filtered list.
type Page struct {
	Total   int64
	Entries []Entry
}

type row struct {
	English       string
	Chinese       string
	Pronunciation string
	QueryCount    int
	Known         int
	CreatedAt     int64
	UpdatedAt     int64
}

func orderBy(s Sort) string {
	if s == SortLookups {
		return "ud.query_count DESC, ud.updated_at DESC, w.english ASC"
	}
	return "ud.updated_at DESC, w.english ASC"
}

// likeEscaper makes a search term literal inside LIKE ... ESCAPE '\'.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// List returns one page of userID's word list, most recently looked up first.
//
// Definitions are shown for every row the user has, AI-made ones included,
// as Home's "Recent words" already does: the user only has the row because
// the definition was shown to them when they looked the word up.
func List(ctx context.Context, userID string, q Query) (Page, error) {
	q = q.normalize()

	filtered := func() *gorm.DB {
		db := sqlitex.DB.WithContext(ctx).
			Table("user_dicts AS ud").
			Joins("JOIN words w ON w.id = ud.word_id").
			Where("ud.user_id = ? AND w.deleted_at IS NULL", userID)
		switch q.Status {
		case StatusLearning:
			db = db.Where("ud.already_acquainted = 0")
		case StatusKnown:
			db = db.Where("ud.already_acquainted = 1")
		}
		if s := strings.TrimSpace(q.Search); s != "" {
			// SQLite's LIKE is case-insensitive for ASCII, matching
			// words.english COLLATE NOCASE (ADR-043).
			db = db.Where(`w.english LIKE ? ESCAPE '\'`, likeEscaper.Replace(s)+"%")
		}
		return db
	}

	var total int64
	if err := filtered().Count(&total).Error; err != nil {
		return Page{}, err
	}

	var rows []row
	if err := filtered().
		Select(`w.english AS english,
		        COALESCE(w.chinese, '') AS chinese,
		        COALESCE(w.pronunciation, '') AS pronunciation,
		        ud.query_count AS query_count,
		        ud.already_acquainted AS known,
		        ud.created_at AS created_at,
		        ud.updated_at AS updated_at`).
		Order(orderBy(q.Sort)).
		Limit(q.Limit).
		Offset(q.Offset).
		Scan(&rows).Error; err != nil {
		return Page{}, err
	}

	entries := make([]Entry, len(rows))
	for i, r := range rows {
		entries[i] = Entry{
			English:         r.English,
			Chinese:         r.Chinese,
			Pronunciation:   r.Pronunciation,
			QueryCount:      r.QueryCount,
			Known:           r.Known == 1,
			FirstLookedUpAt: time.UnixMilli(r.CreatedAt).UTC(),
			LastLookedUpAt:  time.UnixMilli(r.UpdatedAt).UTC(),
		}
	}
	return Page{Total: total, Entries: entries}, nil
}

// Remove takes english off userID's word list by deleting its user_dicts row,
// so the word is back to never looked up: no lookup count, not known, not
// underlined. Daily stats already reported for it stay as they were.
func Remove(ctx context.Context, userID, english string) error {
	return sqlitex.DB.WithContext(ctx).Exec(`
		DELETE FROM user_dicts
		WHERE user_id = ?
		  AND word_id IN (SELECT id FROM words WHERE english = ?)`,
		userID, english).Error
}
