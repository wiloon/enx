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
	Raw           string
	English       string
	Chinese       string
	Pronunciation string
	Key           string

	// 0: false, 1: true
	AlreadyAcquainted int
	LoadCount         int
}

func (word *Word) FindId() {
	sWord := repo.GetWordByEnglish(word.Key)
	word.Id = sWord.Id
}

func (word *Word) SetEnglish(english string) {
	word.Raw = english
	
	if strings.Contains(english, "'s") {
		tmpKey := strings.Replace(english, "'s", "", -1)
		word.English = tmpKey
		word.Key = strings.ToLower(tmpKey)
	} else {
		word.English = english
		word.Key = strings.ToLower(english)
	}
	logger.Info("set english, raw: %s, english: %s, key: %s", word.Raw, word.English, word.Key)
}
func (word *Word) FindQueryCount() int {
	qc, acquainted := repo.GetUserWordQueryCount(word.Id, 0)
	logger.Debugf("find query count, word id: %d, word: %s, query count: %d", word.Id, word.English, qc)
	word.LoadCount = qc
	word.AlreadyAcquainted = acquainted
	return qc
}

func (word *Word) FindLoadCountById() int {
	sqlitex.DB.Table("words").Where("words.id=?", word.Id).Scan(&word)
	logger.Debugf("find one load count, word: %+v", word)
	return word.LoadCount
}
func (word *Word) Translate() *Word {
	// search word in db by English, e.g. French
	// do not search db with lower case, since youdao api is case sensitive
	sWord := repo.Translate(word.English)
	word.Id = sWord.Id
	word.Chinese = sWord.Chinese
	word.LoadCount = sWord.LoadCount
	word.Pronunciation = sWord.Pronunciation
	logger.Debugf("translate word, id: %v, english: %s", sWord.Id, word.Key)
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
