package dictionary

import (
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
)

func DictTranslate(english string) Word {
	sWord := Word{}
	sqlitex.DB.Where("english=?", english).Find(&sWord)
	logger.Debugf("find word, id: %v, english: %s", sWord.Id, sWord.English)
	return sWord
}
