package repo

import (
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"time"
)

type Word struct {
	Id             int
	English        string
	LoadCount      int
	Chinese        string
	Pronunciation  string
	CreateDatetime time.Time
	UpdateDatetime time.Time
}

type UserDict struct {
	WordId            int
	QueryCount        int
	UserId            int `json:"user_id" gorm:"default:1"`
	AlreadyAcquainted int
	UpdateTime        time.Time
}

type YoudaoQueryHistory struct {
	English string
	Result  string
	Exist   int
}

// GetWordByEnglish get word id by english
func GetWordByEnglish(english string) *Word {
	word := Word{}
	sqlitex.DB.Where("english COLLATE NOCASE =?", english).Find(&word)
	logger.Debugf("find word, id: %v, english: %s", word.Id, word.English)
	return &word
}

func GetWordByEnglishCaseSensitive(english string) *Word {
	word := Word{}
	sqlitex.DB.Where("english =?", english).Order("id desc").Find(&word)
	logger.Debugf("find word, id: %v, english: %s", word.Id, word.English)
	return &word
}

// GetUserWordQueryCount get user word query count
func GetUserWordQueryCount(wordId, userId int) (int, int) {
	sud := UserDict{}
	sud.UserId = userId
	sud.WordId = wordId

	sqlitex.DB.Table("user_dicts").
		Where("user_dicts.word_id=? and user_dicts.user_id=?", sud.WordId, sud.UserId).Scan(&sud)
	return sud.QueryCount, sud.AlreadyAcquainted
}

func Translate(key string) Word {
	sWord := Word{}
	sqlitex.DB.Where("english COLLATE NOCASE = ?", key).Find(&sWord)
	logger.Debugf("find in local db, result, id: %v, english: %s", sWord.Id, key)
	return sWord
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
    // Implement the function logic here
    // For example, count the number of words with the given English word
    var count int64
    sqlitex.DB.Table("words").Where("english = ?", english).Count(&count)
    return int(count)
}

func DeleteDuplicateWord(english string, excludeId int) {
	// Delete duplicate words with the given English word, excluding the word with excludeId
	sqlitex.DB.Where("english = ? AND id != ?", english, excludeId).Delete(&Word{})
	logger.Debugf("deleted duplicate words with english: %s, excluding id: %d", english, excludeId)
}