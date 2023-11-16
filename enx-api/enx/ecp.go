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

func (word *Word) FindId() {
	sWord := storage.Word{}
	sqlitex.DB.Where("english=?", word.Key).Find(&sWord)
	logger.Debugf("find word, id: %v, english: %s", sWord.Id, sWord.English)
	word.Id = sWord.Id
}

func (word *Word) SetEnglish(english string) {
	word.English = english
	word.Key = strings.ToLower(english)
}
func (word *Word) FindQueryCount() int {
	sud := storage.UserDict{}
	sud.UserId = 0
	sud.WordId = word.Id

	sqlitex.DB.Table("user_dicts").
		Where("user_dicts.word_id=? and user_dicts.user_id=?", sud.WordId, sud.UserId).Scan(&sud)
	logger.Debugf("find query count, word id: %d, word: %s, query count: %d", sud.WordId, word.English, sud.UserId)
	word.LoadCount = sud.QueryCount
	return word.LoadCount
}

func (word *Word) FindLoadCountById() int {
	sqlitex.DB.Table("words").Where("words.id=?", word.Id).Scan(&word)
	logger.Debugf("find load count, word: %+v", word)
	return word.LoadCount
}
func (word *Word) Translate() *Word {
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
