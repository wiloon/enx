package enx

import (
	"enx-server/repo"
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
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
	sWord := repo.GetWordByEnglish(word.Key)
	word.Id = sWord.Id
}

func (word *Word) SetEnglish(english string) {
	word.English = english
	word.Key = strings.ToLower(english)
}
func (word *Word) FindQueryCount() int {
	qc := repo.GetUserWordQueryCount(word.Id, 0)
	logger.Debugf("find query count, word id: %d, word: %s, query count: %d", word.Id, word.English, 0)
	word.LoadCount = qc
	return qc
}

func (word *Word) FindLoadCountById() int {
	sqlitex.DB.Table("words").Where("words.id=?", word.Id).Scan(&word)
	logger.Debugf("find load count, word: %+v", word)
	return word.LoadCount
}
func (word *Word) Translate() *Word {

	sWord := repo.Translate(word.Key)
	logger.Debugf("find word, id: %v, english: %s", sWord.Id, sWord.English)
	word.Id = sWord.Id
	word.Chinese = sWord.Chinese
	word.LoadCount = sWord.LoadCount
	word.Pronunciation = sWord.Pronunciation
	return word
}

func (word *Word) Save() {
	sWord := repo.Word{}
	sWord.CreateDatetime = time.Now()
	sWord.UpdateDatetime = time.Now()
	sWord.English = word.Key
	sWord.Chinese = word.Chinese
	sWord.Pronunciation = word.Pronunciation
	sWord.LoadCount = word.LoadCount
	tx := sqlitex.DB.Create(&sWord)
	logger.Debugf("save word: %v, tx: %v", sWord, tx)

	//sUserDict:=repo.UserDict{}
	//sUserDict.WordId
}

func (word *Word) UpdateLoadCount() {
	sWord := repo.Word{}
	sqlitex.DB.Model(&sWord).
		Where("english=?", word.Key).
		Updates(map[string]interface{}{
			"load_count":      word.LoadCount,
			"update_datetime": time.Now()})
	logger.Debugf("update word: %v", word)
}
