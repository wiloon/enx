package enx

import (
	"enx-server/repo"
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"time"
)

type UserDict struct {
	// default user id is 1
	UserId     int `json:"user_id" gorm:"default:1"`
	WordId     int
	QueryCount int
	// 0: false, 1: true
	AlreadyAcquainted int
}

func (ud *UserDict) UpdateQueryCount() {
	sud := repo.UserDict{}
	sud.UserId = ud.UserId
	sud.WordId = ud.WordId
	sqlitex.DB.Model(&sud).
		Where("word_id=? and user_id=?", sud.WordId, sud.UserId).
		Updates(map[string]interface{}{
			"query_count": ud.QueryCount,
			"update_time": time.Now()})
	logger.Debugf("update user dict: %v", ud)
}

func (ud *UserDict) Save() {
	sud := repo.UserDict{}
	sud.UserId = ud.UserId
	sud.WordId = ud.WordId
	sud.QueryCount = ud.QueryCount
	sud.AlreadyAcquainted = ud.AlreadyAcquainted
	sud.UpdateTime = time.Now()
	sqlitex.DB.Create(&sud)
	logger.Debugf("create user dict, word id: %v, query count: %v", sud.WordId, sud.QueryCount)
}

func (ud *UserDict) Mark() {
	sud := repo.UserDict{
		UserId: ud.UserId,
		WordId: ud.WordId,
		UpdateTime: time.Now(),
	}

	if ud.IsExist() {
		if ud.AlreadyAcquainted == 1 {
			ud.AlreadyAcquainted = 0
		} else if ud.AlreadyAcquainted == 0 {
			ud.AlreadyAcquainted = 1
		}
		sud.AlreadyAcquainted = ud.AlreadyAcquainted
		sqlitex.DB.Model(&sud).Where("user_id=? and word_id=?", sud.UserId, sud.WordId).
			Updates(map[string]interface{}{"already_acquainted": sud.AlreadyAcquainted})
	} else {
		ud.AlreadyAcquainted = 1
		sud.AlreadyAcquainted = ud.AlreadyAcquainted
		sqlitex.DB.Create(&sud)
	}
	logger.Debugf("update user dict: %v, user_id: %v", sud, sud.UserId)
}

func (ud *UserDict) IsExist() bool {
	sud := repo.UserDict{
		UserId: ud.UserId,
		WordId: ud.WordId,
	}
	userDictTmp := repo.UserDict{}
	sqlitex.DB.Where("word_id=? and user_id=?", sud.WordId, sud.UserId).Find(&userDictTmp)
	if userDictTmp.WordId == 0 {
		logger.Infof("user dict record not exist, word id: %v, user_id: %v", sud.WordId, sud.UserId)
		return false
	} else {
		ud.AlreadyAcquainted = userDictTmp.AlreadyAcquainted
		ud.QueryCount = userDictTmp.QueryCount
		logger.Infof("user dict record exist, word id: %v, user_id: %v, query count: %v, acquainted: %v", 
			sud.WordId, sud.UserId, ud.QueryCount, ud.AlreadyAcquainted)
		return true
	}
}
