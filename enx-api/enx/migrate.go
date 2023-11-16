package enx

import (
	"enx-server/storage"
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
	"time"
)

func CheckAndMigrateQueryCount(wordId int) {
	// check if word exist in user dict
	ud := UserDict{}
	ud.WordId = wordId
	if !ud.IsExist() {
		// if not exit select words table and insert into user dict
		word := Word{}
		word.Id = wordId
		word.FindLoadCountById()
		logger.Infof("one word query count found, word: %+v", word)

		// insert into user dict
		sud := storage.UserDict{}
		sud.UserId = 0
		sud.UpdateTime = time.Now()
		sud.WordId = ud.WordId
		sud.AlreadyAcquainted = 0
		sud.QueryCount = word.LoadCount
		sqlitex.DB.Create(&sud)
		logger.Infof("one word query count migrated, word: %+v", word)
	}
}
