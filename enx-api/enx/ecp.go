package enx

import (
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
	"strings"
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

func (word *Word) SetEnglish(english string) {
	word.English = strings.ToLower(english)
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

func (word *Word) Save() {
	sqlitex.DB.Create(word)
	logger.Debugf("save word: %v", word)
}

func (word *Word) UpdateLoadCount() {
	sqlitex.DB.Model(word).
		Where("id=?", word.Id).
		Updates(map[string]interface{}{
			"load_count":      word.LoadCount,
			"update_datetime": word.UpdateDatetime})
	logger.Debugf("update word: %v", word)
}
