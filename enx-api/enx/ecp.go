package enx

import (
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
)

type Word struct {
	English   string
	LoadCount int
}

func (word *Word) FindLoadCount() int {
	sqlitex.DB.Where("english=?", word.English).Find(word)
	logger.Debugf("word: %v", word)
	return word.LoadCount
}
