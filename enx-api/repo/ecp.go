package repo

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"time"
)

type Word struct {
	Id             string    `gorm:"column:id;primaryKey"` // UUID
	English        string    `gorm:"column:english;unique;not null"`
	LoadCount      int       `gorm:"column:load_count;default:0"`
	Chinese        string    `gorm:"column:chinese"`
	Pronunciation  string    `gorm:"column:pronunciation"`
	CreatedAt      int64     `gorm:"column:created_at"` // Unix milliseconds
	UpdatedAt      int64     `gorm:"column:updated_at"` // Unix milliseconds
	DeletedAt      *int64    `gorm:"column:deleted_at"` // NULL or Unix milliseconds
	CreateDatetime time.Time `gorm:"-"`                 // For compatibility
	UpdateDatetime time.Time `gorm:"-"`                 // For compatibility
}

func (Word) TableName() string {
	return "words"
}

type UserDict struct {
	UserId            string    `gorm:"column:user_id;primaryKey"`
	WordId            string    `gorm:"column:word_id;primaryKey"`
	QueryCount        int       `gorm:"column:query_count;default:0"`
	AlreadyAcquainted int       `gorm:"column:already_acquainted;default:0"`
	CreatedAt         int64     `gorm:"column:created_at"`
	UpdatedAt         int64     `gorm:"column:updated_at"`
	UpdateTime        time.Time `gorm:"-"` // For compatibility
}

func (UserDict) TableName() string {
	return "user_dicts"
}

// GetWordByEnglish looks up a word by exact english, then case-insensitive match.
func GetWordByEnglish(english string) *Word {
	word := &Word{}
	err := sqlitex.DB.Where("english = ? AND deleted_at IS NULL", english).First(word).Error
	if err != nil {
		err = sqlitex.DB.Where("LOWER(english) = LOWER(?) AND deleted_at IS NULL", english).First(word).Error
	}
	if err != nil {
		logger.Debugf("word not found: %s, error: %v", english, err)
		return &Word{} // Return empty word for compatibility
	}

	// Convert timestamps for compatibility
	if word.CreatedAt > 0 {
		word.CreateDatetime = time.UnixMilli(word.CreatedAt)
	}
	if word.UpdatedAt > 0 {
		word.UpdateDatetime = time.UnixMilli(word.UpdatedAt)
	}

	logger.Debugf("find word via GORM, id: %s, english: %s", word.Id, word.English)
	return word
}

// GetUserWordQueryCount gets a user's query count and acquainted flag for a
// word via GORM. found reports whether a user_dicts row actually exists --
// callers must not infer existence from queryCount/alreadyAcquainted being
// zero, since a legitimately existing row (e.g. a word just unmarked via
// UserDict.Mark) can have both fields at zero.
func GetUserWordQueryCount(wordId, userId string) (queryCount int, alreadyAcquainted int, found bool) {
	userDict := &UserDict{}
	err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userId, wordId).First(userDict).Error
	if err != nil {
		logger.Debugf("user dict not found: user_id=%s, word_id=%s, error: %v", userId, wordId, err)
		return 0, 0, false
	}

	return userDict.QueryCount, userDict.AlreadyAcquainted, true
}

// ReviewLog exposes RecordWordLookup as the translate handler's ReviewLog.
type ReviewLog struct{}

func (ReviewLog) RecordWordLookup(userId, wordId string) (int, int, error) {
	return RecordWordLookup(userId, wordId)
}

// RecordWordLookup counts one lookup of wordId by userId for the review
// system: the first lookup starts query_count at 1, a repeat adds 1, and
// looking up a word the user had marked as known puts it back into review.
// It is a single statement, so concurrent lookups can't lose an increment.
func RecordWordLookup(userId, wordId string) (queryCount int, alreadyAcquainted int, err error) {
	now := time.Now().UnixMilli()
	var row UserDict
	err = sqlitex.DB.Raw(`
		INSERT INTO user_dicts (user_id, word_id, query_count, already_acquainted, created_at, updated_at)
		VALUES (?, ?, 1, 0, ?, ?)
		ON CONFLICT (user_id, word_id) DO UPDATE SET
			query_count = COALESCE(query_count, 0) + 1,
			already_acquainted = 0,
			updated_at = excluded.updated_at
		RETURNING query_count, already_acquainted`,
		userId, wordId, now, now).Scan(&row).Error
	return row.QueryCount, row.AlreadyAcquainted, err
}

// ToggleAcquainted flips userId's "already know this word" flag for wordId
// in one statement: a word with no user_dicts row yet becomes known with
// query_count 0. It returns the row's state afterwards.
func ToggleAcquainted(userId, wordId string) (queryCount int, alreadyAcquainted int, err error) {
	now := time.Now().UnixMilli()
	var row UserDict
	err = sqlitex.DB.Raw(`
		INSERT INTO user_dicts (user_id, word_id, query_count, already_acquainted, created_at, updated_at)
		VALUES (?, ?, 0, 1, ?, ?)
		ON CONFLICT (user_id, word_id) DO UPDATE SET
			already_acquainted = 1 - COALESCE(already_acquainted, 0),
			updated_at = excluded.updated_at
		RETURNING query_count, already_acquainted`,
		userId, wordId, now, now).Scan(&row).Error
	return row.QueryCount, row.AlreadyAcquainted, err
}
