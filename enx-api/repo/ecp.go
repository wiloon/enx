package repo

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Word struct {
	Id              string    `gorm:"column:id;primaryKey"`                                                           // UUID
	English         string    `gorm:"column:english;type:TEXT COLLATE NOCASE;not null;uniqueIndex:idx_words_english"` // ADR-043, same as sqlitex.Word
	LoadCount       int       `gorm:"column:load_count;default:0"`
	Chinese         string    `gorm:"column:chinese"`
	Pronunciation   string    `gorm:"column:pronunciation"`
	CreatedAt       int64     `gorm:"column:created_at"`            // Unix milliseconds
	UpdatedAt       int64     `gorm:"column:updated_at"`            // Unix milliseconds
	DeletedAt       *int64    `gorm:"column:deleted_at"`            // NULL or Unix milliseconds
	Source          string    `gorm:"column:source;default:ecdict"` // WordSourceECDICT or WordSourceAI (ADR-045)
	AdminEditedAt   *int64    `gorm:"column:admin_edited_at"`       // NULL = no admin has edited the row; else Unix milliseconds
	AIQuality       *int      `gorm:"column:ai_quality"`            // source "ai" only: the model's 0-10 confidence
	AIPromptVersion *string   `gorm:"column:ai_prompt_version"`     // source "ai" only: the prompt that produced it
	CreateDatetime  time.Time `gorm:"-"`                            // For compatibility
	UpdateDatetime  time.Time `gorm:"-"`                            // For compatibility
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
	UserId     string    `gorm:"column:user_id;primaryKey"`
	WordId     string    `gorm:"column:word_id;primaryKey"`
	QueryCount int       `gorm:"column:query_count;default:0"`
	Known      bool      `gorm:"column:known;default:false"`
	CreatedAt  int64     `gorm:"column:created_at"`
	UpdatedAt  int64     `gorm:"column:updated_at"`
	UpdateTime time.Time `gorm:"-"` // For compatibility
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

// InsertWord inserts row as a new live row: a fresh UUID, millisecond
// timestamps and the canonical spelling are set here, and row.Id is filled
// on success. It fails on the UNIQUE constraint when the word is already in
// the table (ADR-043), leaving row.Id empty, so a caller never holds an id
// that was not persisted. An empty Source is stored as "ecdict".
func InsertWord(row *Word) error {
	now := time.Now().UnixMilli()
	insert := *row
	insert.Id = uuid.NewString()
	insert.English = CanonicalEnglish(row.English)
	insert.CreatedAt, insert.UpdatedAt = now, now
	if insert.Source == "" {
		insert.Source = WordSourceECDICT
	}
	if err := sqlitex.DB.Create(&insert).Error; err != nil {
		return err
	}
	*row = insert
	return nil
}

// FindWordForLookup is GetWordByEnglish for the user lookup path. Unless
// includeAI, it leaves out the rows only users who can use AI may see: AI-made
// definitions no admin has edited yet (ADR-045 Decision 6). The exclusion is
// in the query rather than applied after reading, so a hidden row is never
// loaded and cannot leak through a caller that forgets to filter it.
//
// A row with no Chinese is a miss (ADR-098 Decision 5): the caller goes on to
// the dictionaries and fills it.
//
// A miss returns an empty Word and no error. Any other failure is returned,
// never folded into a miss: a lookup that reads a miss goes on to paid AI
// fallback (#1037).
func FindWordForLookup(english string, includeAI bool) (*Word, error) {
	english = CanonicalEnglish(english)
	query := sqlitex.DB.Where("english = ? AND deleted_at IS NULL AND COALESCE(chinese, '') <> ''", english)
	if !includeAI {
		query = query.Where("(source <> ? OR admin_edited_at IS NOT NULL)", WordSourceAI)
	}
	word := &Word{}
	if err := query.First(word).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &Word{}, nil
		}
		return &Word{}, fmt.Errorf("find word %q for lookup: %w", english, err)
	}
	return word, nil
}

// GetUserWordQueryCount gets a user's query count and known flag for a
// word via GORM. found reports whether a user_dicts row actually exists --
// callers must not infer existence from queryCount/known being
// zero or false, since a legitimately existing row (e.g. a word just
// unmarked) can have both.
func GetUserWordQueryCount(wordId, userId string) (queryCount int, known bool, found bool) {
	userDict := &UserDict{}
	err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userId, wordId).First(userDict).Error
	if err != nil {
		logger.Debugf("user dict not found: user_id=%s, word_id=%s, error: %v", userId, wordId, err)
		return 0, false, false
	}

	return userDict.QueryCount, userDict.Known, true
}

// WordExists reports whether wordId is a words row that is not deleted.
func WordExists(wordId string) (bool, error) {
	var n int64
	err := sqlitex.DB.Model(&Word{}).Where("id = ? AND deleted_at IS NULL", wordId).Count(&n).Error
	return n > 0, err
}

// WordCounts is the translate handler's read-only view of a user's query
// count and known flag for a word. review.Service writes them.
type WordCounts struct{}

// CountAndKnown is userId's current query count and known flag for wordId;
// 0 and false when the user has never looked it up or marked it.
func (WordCounts) CountAndKnown(userId, wordId string) (int, bool, error) {
	qc, known, _ := GetUserWordQueryCount(wordId, userId)
	return qc, known, nil
}
