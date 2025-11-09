package main

import (
	"enx-api/utils/logger"
	"enx-api/utils/password"
	"enx-api/utils/sqlitex"
)

func main() {
	// Initialize database connection
	sqlitex.Init()

	// Run password migration
	if err := password.MigratePasswords(); err != nil {
		logger.Errorf("password migration failed: %v", err)
		return
	}

	logger.Info("password migration completed successfully")
}
