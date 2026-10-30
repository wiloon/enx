package main

import "enx-api/utils/sqlitex"

// initializeBillingDatabase initializes or reopens the supported billing schema.
func initializeBillingDatabase(path, level string) error {
	return sqlitex.InitWithLogLevel(path, level)
}
