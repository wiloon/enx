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
	sud.UpdateTime = time.Now()
	sud.WordId = ud.WordId
	sud.AlreadyAcquainted = ud.AlreadyAcquainted
	sqlitex.DB.Updates(&sud)
	logger.Debugf("update user dict: %v", sud)
}
