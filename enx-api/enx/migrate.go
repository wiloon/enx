package enx

import (
	"enx-server/repo"
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"time"
)

func CheckAndMigrateQueryCount(wordId int) {
	// check if word exist in user dict
	ud := UserDict{}
	ud.WordId = wordId
	if !ud.IsExist() {
		// word exist but ud not found
		// if word not exit in user dict, select words table and insert into user dict
		word := Word{}
		word.Id = wordId
		word.FindLoadCountById()
		logger.Infof("one word query count found, word: %+v", word)

		// insert into user dict
		sud := repo.UserDict{}
		sud.UserId = 1
		sud.UpdateTime = time.Now()
		sud.WordId = ud.WordId
		sud.AlreadyAcquainted = 0
		sud.QueryCount = word.LoadCount
		sqlitex.DB.Create(&sud)
		logger.Infof("one word query count migrated, word: %+v", word)
	}
}
