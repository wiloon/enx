package enx

import (
	"enx-server/storage"
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
	"strings"
	"time"
)

type Word struct {
	English       string
	LoadCount     int
	Chinese       string
	Pronunciation string
	SearchKey     string
}

func (word *Word) SetEnglish(english string) {
	word.English = english
	word.SearchKey = strings.ToLower(english)
}
func (word *Word) FindLoadCount() int {
	sWord := storage.Word{}
	sWord.English = word.SearchKey
	sqlitex.DB.Where("english=?", sWord.English).Find(&sWord)
	word.Chinese = sWord.Chinese
	word.Pronunciation = sWord.Pronunciation
	word.LoadCount = sWord.LoadCount
	logger.Debugf("word: %v", word)
	return word.LoadCount
}

func (word *Word) FindChinese() *Word {
	sWord := storage.Word{}
	sqlitex.DB.Where("english=?", word.SearchKey).Find(&sWord)
	logger.Debugf("word: %v", sWord)
	word.Chinese = sWord.Chinese
	word.LoadCount = sWord.LoadCount
	word.Pronunciation = sWord.Pronunciation
	return word
}

func (word *Word) Save() {
	sWord := storage.Word{}
	sWord.CreateDatetime = time.Now()
	sWord.UpdateDatetime = time.Now()
	sWord.English = word.SearchKey
	sWord.Chinese = word.Chinese
	sWord.Pronunciation = word.Pronunciation
	sWord.LoadCount = word.LoadCount
	sqlitex.DB.Create(&sWord)
	logger.Debugf("save word: %v", sWord)
}

func (word *Word) UpdateLoadCount() {
	sWord := storage.Word{}
	sqlitex.DB.Model(&sWord).
		Where("english=?", word.SearchKey).
		Updates(map[string]interface{}{
			"load_count":      word.LoadCount,
			"update_datetime": time.Now()})
	logger.Debugf("update word: %v", word)
}
