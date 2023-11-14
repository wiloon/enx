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
	sud := storage.UserDict{}
	sud.UserId = ud.UserId
	sud.UpdateTime = time.Now()
	sud.WordId = ud.WordId

	if ud.IsExist() {
		if ud.AlreadyAcquainted == 1 {
			ud.AlreadyAcquainted = 0
		} else if ud.AlreadyAcquainted == 0 {
			ud.AlreadyAcquainted = 1
		}
		sud.AlreadyAcquainted = ud.AlreadyAcquainted
		sqlitex.DB.Model(&sud).Where("user_id=? and word_id=?", sud.UserId, sud.WordId).Updates(map[string]interface{}{"already_acquainted": sud.AlreadyAcquainted})
	} else {
		ud.AlreadyAcquainted = 1
		sud.AlreadyAcquainted = ud.AlreadyAcquainted
		sqlitex.DB.Create(&sud)
	}
	logger.Debugf("update user dict: %v", sud)
}

func (ud *UserDict) IsExist() bool {
	sud := storage.UserDict{}
	sud.UserId = ud.UserId
	sud.WordId = ud.WordId
	tmp := storage.UserDict{}
	sqlitex.DB.Where("word_id=? and user_id=?", sud.WordId, sud.UserId).Find(&tmp)
	if tmp.WordId == 0 {
		return false
	} else {
		ud.AlreadyAcquainted = tmp.AlreadyAcquainted
		return true
	}
}
