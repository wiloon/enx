package enx

import (
	"enx-server/storage"
	"enx-server/storage/sqlitex"
	"enx-server/utils/logger"
	"time"
)

type UserDict struct {
	WordId     int
	QueryCount int
	UserId     int
	// 0: false, 1: true
	AlreadyAcquainted int
}

func (ud *UserDict) Mark() {
	ud.AlreadyAcquainted = 1

	sud := storage.UserDict{}
	sud.UserId = ud.UserId
	sud.UpdateTime = time.Now()
	sud.WordId = ud.WordId
	sud.AlreadyAcquainted = ud.AlreadyAcquainted
	tmp := storage.UserDict{}
	sqlitex.DB.Where("word_id=? and user_id=?", sud.WordId, sud.UserId).Find(&tmp)
	if tmp.WordId == 0 {
		sqlitex.DB.Create(&sud)
	} else {
		sqlitex.DB.Updates(&sud)
	}
	logger.Debugf("update user dict: %v", sud)
}
