package repo

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"strings"
	"time"
)

type Word struct {
	Id             string    `gorm:"column:id;primaryKey"`                                                           // UUID
	English        string    `gorm:"column:english;type:TEXT COLLATE NOCASE;not null;uniqueIndex:idx_words_english"` // ADR-043, same as sqlitex.Word
	LoadCount      int       `gorm:"column:load_count;default:0"`
	Chinese        string    `gorm:"column:chinese"`
	Pronunciation  string    `gorm:"column:pronunciation"`
	CreatedAt      int64     `gorm:"column:created_at"`            // Unix milliseconds
	UpdatedAt      int64     `gorm:"column:updated_at"`            // Unix milliseconds
	DeletedAt      *int64    `gorm:"column:deleted_at"`            // NULL or Unix milliseconds
	Source         string    `gorm:"column:source;default:ecdict"` // WordSourceECDICT or WordSourceAI (ADR-045)
	AdminEditedAt  *int64    `gorm:"column:admin_edited_at"`       // NULL = no admin has edited the row; else Unix milliseconds
	CreateDatetime time.Time `gorm:"-"`                            // For compatibility
	UpdateDatetime time.Time `gorm:"-"`                            // For compatibility
}

func (Word) TableName() string {
	return "words"
}

// Where a words row's definition first came from (ADR-045).
const (
	WordSourceECDICT = "ecdict"
	WordSourceAI     = "ai"
)

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

// CanonicalEnglish is the form a word is stored and looked up under: curly
// apostrophes become straight ones ("don’t" -> "don't"), so both spellings
// are one row (ADR-043). Case needs no folding here: words.english is
// COLLATE NOCASE.
func CanonicalEnglish(english string) string {
	return strings.ReplaceAll(english, "’", "'")
}

// GetWordByEnglish looks up a live word, in any case and either apostrophe
// (ADR-043): one query on idx_words_english.
func GetWordByEnglish(english string) *Word {
	english = CanonicalEnglish(english)
	word := &Word{}
	err := sqlitex.DB.Where("english = ? AND deleted_at IS NULL", english).First(word).Error
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

// FindWordForLookup is GetWordByEnglish for the user lookup path. Unless
// includeAI, it leaves out the rows only users who can use AI may see: AI-made
// definitions no admin has edited yet (ADR-045 Decision 6). The exclusion is
// in the query rather than applied after reading, so a hidden row is never
// loaded and cannot leak through a caller that forgets to filter it.
func FindWordForLookup(english string, includeAI bool) *Word {
	english = CanonicalEnglish(english)
	query := sqlitex.DB.Where("english = ? AND deleted_at IS NULL", english)
	if !includeAI {
		query = query.Where("(source <> ? OR admin_edited_at IS NOT NULL)", WordSourceAI)
	}
	word := &Word{}
	if err := query.First(word).Error; err != nil {
		logger.Debugf("word not found for lookup: %s (includeAI=%v): %v", english, includeAI, err)
		return &Word{}
	}
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

// WordState is a words row with one user's review state for it.
type WordState struct {
	Id                string
	English           string
	QueryCount        int
	AlreadyAcquainted int
}

// wordStatesSQL takes the user id and a list of canonical englishes;
// english is COLLATE NOCASE, so the IN matches any case.
const wordStatesSQL = `
	SELECT w.id, w.english,
		COALESCE(ud.query_count, 0) AS query_count,
		COALESCE(ud.already_acquainted, 0) AS already_acquainted
	FROM words w
	LEFT JOIN user_dicts ud ON ud.word_id = w.id AND ud.user_id = ?
	WHERE w.english IN ? AND +w.deleted_at IS NULL`

// wordStatesChunk keeps each IN list well under SQLite's bound-parameter limit.
const wordStatesChunk = 500

// WordStatesByEnglish returns every live words row matching one of
// englishes (any case, either apostrophe), with userId's review state (zero
// when the user has no row for it). One query per 500 words, on
// idx_words_english. The unary + on deleted_at keeps SQLite's planner off
// idx_words_deleted_at: with an IN list it otherwise prefers that index,
// which matches every live row, i.e. scans the table.
func WordStatesByEnglish(userId string, englishes []string) ([]WordState, error) {
	keys := make([]string, 0, len(englishes))
	for _, e := range englishes {
		keys = append(keys, CanonicalEnglish(e))
	}
	var states []WordState
	for start := 0; start < len(keys); start += wordStatesChunk {
		end := min(start+wordStatesChunk, len(keys))
		var chunk []WordState
		err := sqlitex.DB.Raw(wordStatesSQL, userId, keys[start:end]).Scan(&chunk).Error
		if err != nil {
			return nil, err
		}
		states = append(states, chunk...)
	}
	return states, nil
}
