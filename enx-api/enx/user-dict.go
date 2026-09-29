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

// IsExist checks if user dict record exists in database
func (ud *UserDict) IsExist() bool {
	queryCount, alreadyAcquainted, found := repo.GetUserWordQueryCount(ud.WordId, ud.UserId)
	if !found {
		logger.Debugf("user dict record not found, word_id: %s, user_id: %s",
			ud.WordId, ud.UserId)
		return false
	}

	// Update the struct with fetched values
	ud.QueryCount = queryCount
	ud.AlreadyAcquainted = alreadyAcquainted
	logger.Debugf("user dict record found, word_id: %s, user_id: %s, query_count: %d, acquainted: %d",
		ud.WordId, ud.UserId, ud.QueryCount, ud.AlreadyAcquainted)
	return true
}
