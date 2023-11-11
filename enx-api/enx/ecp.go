package enx

import (
	"enx-server/storage"
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
	"strings"
	"time"
)

type Word struct {
	Id            int
	English       string
	LoadCount     int
	Chinese       string
	Pronunciation string
	Key           string
	// 0: false, 1: true
	AlreadyAcquainted int
}

func (word *Word) SetEnglish(english string) {
	word.English = english
	word.Key = strings.ToLower(english)
}
func (word *Word) FindLoadCount() int {
	sWord := storage.Word{}
	sWord.English = word.Key
	// db.Model(&User{}).Select("users.name, emails.email").Joins("left join emails on emails.user_id = users.id").Scan(&result{})
	sqlitex.DB.Table("words").Joins("left join user_dicts ud on words.id = ud.word_id and user_id=0").Where("words.english=?", word.Key).Scan(&word)
	logger.Debugf("word: %v", word)
	return word.LoadCount
}

func (word *Word) FindChinese() *Word {
	sWord := storage.Word{}
	sqlitex.DB.Where("english=?", word.Key).Find(&sWord)
	logger.Debugf("find word, id: %v, english: %s", sWord.Id, sWord.English)
	word.Id = sWord.Id
	word.Chinese = sWord.Chinese
	word.LoadCount = sWord.LoadCount
	word.Pronunciation = sWord.Pronunciation
	return word
}

func (word *Word) Save() {
	sWord := storage.Word{}
	sWord.CreateDatetime = time.Now()
	sWord.UpdateDatetime = time.Now()
	sWord.English = word.Key
	sWord.Chinese = word.Chinese
	sWord.Pronunciation = word.Pronunciation
	sWord.LoadCount = word.LoadCount
	tx := sqlitex.DB.Create(&sWord)
	logger.Debugf("save word: %v, tx: %v", sWord, tx)

	//sUserDict:=storage.UserDict{}
	//sUserDict.WordId
}

func (word *Word) UpdateLoadCount() {
	sWord := storage.Word{}
	sqlitex.DB.Model(&sWord).
		Where("english=?", word.Key).
		Updates(map[string]interface{}{
			"load_count":      word.LoadCount,
			"update_datetime": time.Now()})
	logger.Debugf("update word: %v", word)
}
