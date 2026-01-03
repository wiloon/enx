package repo

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"time"
)

type Word struct {
	Id             string    `gorm:"column:id;primaryKey"` // UUID
	English        string    `gorm:"column:english"`
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

type YoudaoQueryHistory struct {
	English string
	Result  string
	Exist   int
}

// GetWordByEnglish get word id by english
func GetWordByEnglish(english string) *Word {
	word := &Word{}
	err := sqlitex.DB.Where("LOWER(english) = LOWER(?) AND deleted_at IS NULL", english).First(word).Error
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

func GetWordByEnglishCaseSensitive(english string) *Word {
	word := &Word{}
	err := sqlitex.DB.Where("english = ? AND deleted_at IS NULL", english).First(word).Error
	if err != nil {
		logger.Debugf("word not found (case sensitive): %s, error: %v", english, err)
		return &Word{}
	}

	// Convert timestamps for compatibility
	if word.CreatedAt > 0 {
		word.CreateDatetime = time.UnixMilli(word.CreatedAt)
	}
	if word.UpdatedAt > 0 {
		word.UpdateDatetime = time.UnixMilli(word.UpdatedAt)
	}

	return word
}

// GetUserWordQueryCount get user word query count via GORM
func GetUserWordQueryCount(wordId, userId string) (int, int) {
	userDict := &UserDict{}
	err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userId, wordId).First(userDict).Error
	if err != nil {
		logger.Debugf("user dict not found: user_id=%s, word_id=%s, error: %v", userId, wordId, err)
		return 0, 0
	}

	return userDict.QueryCount, userDict.AlreadyAcquainted
}

// UpsertUserDict creates or updates user dictionary entry via GORM
func UpsertUserDict(userId, wordId string, queryCount, alreadyAcquainted int) error {
	now := time.Now().UnixMilli()
	userDict := &UserDict{
		UserId:            userId,
		WordId:            wordId,
		QueryCount:        queryCount,
		AlreadyAcquainted: alreadyAcquainted,
		UpdatedAt:         now,
	}

	// Check if record exists
	var existing UserDict
	err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userId, wordId).First(&existing).Error
	if err != nil {
		// Record doesn't exist, create it
		userDict.CreatedAt = now
		return sqlitex.DB.Create(userDict).Error
	}

	// Record exists, update it
	return sqlitex.DB.Model(&UserDict{}).Where("user_id = ? AND word_id = ?", userId, wordId).Updates(map[string]interface{}{
		"query_count":        queryCount,
		"already_acquainted": alreadyAcquainted,
		"updated_at":         now,
	}).Error
}

func Translate(key string, userId string) Word {
	word := GetWordByEnglish(key)
	if word.Id != "" {
		logger.Debugf("find word via GORM, id: %s, english: %s, user_id: %s", word.Id, key, userId)
		return *word
	}

	logger.Debugf("word not found via GORM: %s, user_id: %s", key, userId)
	return Word{} // Return empty word
}

// IsYouDaoRecordExist check if youdao dict response exist in db
func IsYouDaoRecordExist(words string) (bool, bool, *YoudaoQueryHistory) {
	cacheHit := false
	youdaoCanHandleThisWord := false
	yd := YoudaoQueryHistory{}
	sqlitex.DB.Where("english=?", words).Find(&yd)

	if yd.English != "" {
		cacheHit = true
	}
	if cacheHit && yd.Exist == 1 {
		youdaoCanHandleThisWord = true
	}
	logger.Debugf("check if youdao record exist, english: %s, cache hit: %v, youdao has this word: %v", words, cacheHit, youdaoCanHandleThisWord)
	return cacheHit, youdaoCanHandleThisWord, &yd
}

// SaveYouDaoDictResponse save youdao dict response to db
func SaveYouDaoDictResponse(word, response string, exist int) {
	yqh := YoudaoQueryHistory{}
	yqh.English = word
	yqh.Result = response
	yqh.Exist = exist
	sqlitex.DB.Create(&yqh)
}

func CountByEnglish(english string) int {
	var count int64
	sqlitex.DB.Model(&Word{}).Where("LOWER(english) = LOWER(?) AND deleted_at IS NULL", english).Count(&count)
	logger.Debugf("count by english via GORM, word: %s, count: %d", english, count)
	return int(count)
}

func DeleteDuplicateWord(english string, excludeId string) {
	// This function is no longer needed with UUID-based P2P system
	// Duplicates are prevented by unique constraint on english field
	logger.Debugf("DeleteDuplicateWord called but skipped (P2P system prevents duplicates), english: %s, excluding id: %s", english, excludeId)
}
