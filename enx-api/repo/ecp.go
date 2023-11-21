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
	UpdateTime        time.Time
	UserId            int
	AlreadyAcquainted int
}

type YoudaoQueryHistory struct {
	English string
	Result  string
	Exist   int
}

// GetWordByEnglish get word id by english
func GetWordByEnglish(english string) *Word {
	word := Word{}
	sqlitex.DB.Where("english=?", english).Find(&word)
	logger.Debugf("find word, id: %v, english: %s", word.Id, word.English)
	return &word
}

// GetUserWordQueryCount get user word query count
func GetUserWordQueryCount(wordId, userId int) int {
	sud := UserDict{}
	sud.UserId = userId
	sud.WordId = wordId

	sqlitex.DB.Table("user_dicts").
		Where("user_dicts.word_id=? and user_dicts.user_id=?", sud.WordId, sud.UserId).Scan(&sud)
	return sud.QueryCount
}

func Translate(english string) Word {
	sWord := Word{}
	sqlitex.DB.Where("english=?", english).Find(&sWord)
	logger.Debugf("find word, id: %v, english: %s", sWord.Id, sWord.English)
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
