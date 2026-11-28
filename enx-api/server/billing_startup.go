package server

import (
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// initializeBillingDatabase initializes or reopens the supported billing schema.
func initializeBillingDatabase(path, level string) (*gorm.DB, error) {
	return sqlitex.InitWithLogLevel(path, level)
}
