package enx

import (
	"enx-api/utils/logger"
)

// CheckAndMigrateQueryCount is deprecated - user_dicts now managed by data-service
func CheckAndMigrateQueryCount(wordId string) {
	logger.Warnf("CheckAndMigrateQueryCount is deprecated (user_dicts managed by data-service), wordId: %s", wordId)
	// TODO: Migrate this functionality to data-service if needed
}
