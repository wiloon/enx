package enx

import (
	"enx-api/repo"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
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
			"query_count":        ud.QueryCount,
			"already_acquainted": ud.AlreadyAcquainted,
			"update_time":        time.Now()})
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
	logger.Infof("Mark: Starting mark operation for word_id: %d, user_id: %d", ud.WordId, ud.UserId)
	
	sud := repo.UserDict{
		UserId:     ud.UserId,
		WordId:     ud.WordId,
		UpdateTime: time.Now(),
	}

	if ud.IsExist() {
		logger.Infof("Mark: Record exists, current AlreadyAcquainted: %d", ud.AlreadyAcquainted)
		if ud.AlreadyAcquainted == 1 {
			ud.AlreadyAcquainted = 0
			logger.Infof("Mark: Changed from 1 to 0")
		} else if ud.AlreadyAcquainted == 0 {
			ud.AlreadyAcquainted = 1
			logger.Infof("Mark: Changed from 0 to 1")
		}
		sud.AlreadyAcquainted = ud.AlreadyAcquainted
		logger.Infof("Mark: Updating existing record with AlreadyAcquainted: %d", sud.AlreadyAcquainted)
		result := sqlitex.DB.Model(&sud).Where("user_id=? and word_id=?", sud.UserId, sud.WordId).
			Updates(map[string]interface{}{"already_acquainted": sud.AlreadyAcquainted})
		logger.Infof("Mark: Update result - RowsAffected: %d, Error: %v", result.RowsAffected, result.Error)
		
		// Verify the update by reading back
		var verifyRecord repo.UserDict
		sqlitex.DB.Where("word_id=? and user_id=?", sud.WordId, sud.UserId).First(&verifyRecord)
		logger.Infof("Mark: Verification query - AlreadyAcquainted: %d", verifyRecord.AlreadyAcquainted)
	} else {
		logger.Infof("Mark: Record does not exist, creating new record with AlreadyAcquainted: 1")
		ud.AlreadyAcquainted = 1
		sud.AlreadyAcquainted = ud.AlreadyAcquainted
		sqlitex.DB.Create(&sud)
	}
	logger.Infof("Mark: Final AlreadyAcquainted state: %d", ud.AlreadyAcquainted)
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
