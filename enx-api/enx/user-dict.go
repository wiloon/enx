package enx

import (
	"enx-api/repo"
	"enx-api/utils/logger"
)

type UserDict struct {
	// User ID (UUID)
	UserId     string `json:"user_id"`
	WordId     string `json:"word_id"` // UUID
	QueryCount int    `json:"query_count"`
	// 0: false, 1: true
	AlreadyAcquainted int `json:"already_acquainted"`
}

// UpdateQueryCount updates the query count and acquainted status via gRPC
func (ud *UserDict) UpdateQueryCount() {
	err := repo.UpsertUserDict(ud.UserId, ud.WordId, ud.QueryCount, ud.AlreadyAcquainted)
	if err != nil {
		logger.Errorf("failed to update query count via gRPC: %v", err)
		return
	}
	logger.Debugf("update user dict via gRPC, user_id: %s, word_id: %s, query_count: %d",
		ud.UserId, ud.WordId, ud.QueryCount)
}

// Save creates or updates user dict record via gRPC
func (ud *UserDict) Save() {
	err := repo.UpsertUserDict(ud.UserId, ud.WordId, ud.QueryCount, ud.AlreadyAcquainted)
	if err != nil {
		logger.Errorf("failed to save user dict via gRPC: %v", err)
		return
	}
	logger.Debugf("save user dict via gRPC, user_id: %s, word_id: %s, query_count: %d",
		ud.UserId, ud.WordId, ud.QueryCount)
}

// Mark toggles the already_acquainted flag via gRPC
func (ud *UserDict) Mark() {
	logger.Infof("Mark: Starting mark operation for word_id: %s, user_id: %s", ud.WordId, ud.UserId)

	if ud.IsExist() {
		logger.Infof("Mark: Record exists, current AlreadyAcquainted: %d", ud.AlreadyAcquainted)
		// Toggle the acquainted status
		if ud.AlreadyAcquainted == 1 {
			ud.AlreadyAcquainted = 0
			logger.Infof("Mark: Changed from 1 to 0")
		} else {
			ud.AlreadyAcquainted = 1
			logger.Infof("Mark: Changed from 0 to 1")
		}
	} else {
		logger.Infof("Mark: Record does not exist, creating new record with AlreadyAcquainted: 1")
		ud.AlreadyAcquainted = 1
		ud.QueryCount = 0
	}

	err := repo.UpsertUserDict(ud.UserId, ud.WordId, ud.QueryCount, ud.AlreadyAcquainted)
	if err != nil {
		logger.Errorf("Mark: failed to mark via gRPC: %v", err)
		return
	}
	logger.Infof("Mark: Final AlreadyAcquainted state: %d", ud.AlreadyAcquainted)
}

// IsExist checks if user dict record exists via gRPC
func (ud *UserDict) IsExist() bool {
	queryCount, alreadyAcquainted := repo.GetUserWordQueryCount(ud.WordId, ud.UserId)

	// If both are 0, record might not exist (or both fields are actually 0)
	// We rely on the gRPC implementation returning 0,0 for non-existent records
	if queryCount == 0 && alreadyAcquainted == 0 {
		logger.Debugf("user dict record not found via gRPC, word_id: %s, user_id: %s",
			ud.WordId, ud.UserId)
		return false
	}

	// Update the struct with fetched values
	ud.QueryCount = queryCount
	ud.AlreadyAcquainted = alreadyAcquainted
	logger.Debugf("user dict record found via gRPC, word_id: %s, user_id: %s, query_count: %d, acquainted: %d",
		ud.WordId, ud.UserId, ud.QueryCount, ud.AlreadyAcquainted)
	return true
}
