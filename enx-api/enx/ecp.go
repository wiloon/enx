package enx

import (
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
)

type Word struct {
	English       string
	LoadCount     int
	Chinese       string
	Pronunciation string
}

func (word *Word) FindLoadCount() int {
	sqlitex.DB.Where("english=?", word.English).Find(word)
	logger.Debugf("word: %v", word)
	return word.LoadCount
}

func (word *Word) FindChinese() *Word {
	sqlitex.DB.Where("english=?", word.English).Find(word)
	logger.Debugf("word: %v", word)
	return word
}
