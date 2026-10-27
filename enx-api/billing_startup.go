package main

import "enx-api/utils/sqlitex"

// initializeBillingDatabase prepares the schema for the selected billing path.
func initializeBillingDatabase(path, level string, cutover bool) error {
	if !cutover {
		return sqlitex.InitWithLogLevel(path, level)
	}
	if err := sqlitex.InitForBillingCutover(path, level); err != nil {
		return err
	}
	return sqlitex.MigrateBillingCutover(sqlitex.DB)
}
