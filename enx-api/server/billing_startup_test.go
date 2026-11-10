//go:build integration

package server

import (
	"reflect"
	"testing"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func restoreBillingDatabase(t *testing.T) {
	t.Helper()
	previous := sqlitex.DB
	t.Cleanup(func() { sqlitex.DB = previous })
}

func openBillingDatabase(t *testing.T, open func() error) error {
	t.Helper()
	previous := sqlitex.DB
	err := open()
	closeNewBillingDatabase(t, previous)
	return err
}

func closeNewBillingDatabase(t *testing.T, previous *gorm.DB) {
	t.Helper()
	db := sqlitex.DB
	if db == nil || db == previous {
		return
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err != nil {
			t.Errorf("get underlying database: %v", err)
			return
		}
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})
}

func assertBillingMigrationOrder(t *testing.T) {
	t.Helper()
	var versions []string
	if err := sqlitex.DB.Raw("SELECT version FROM schema_migrations ORDER BY rowid").Scan(&versions).Error; err != nil {
		t.Fatal(err)
	}
	want := sqlitex.BillingMigrationVersions()
	if !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration order = %v, want %v", versions, want)
	}
}
