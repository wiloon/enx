// Package sqlitextest gives tests a database handle.
package sqlitextest

import (
	"path/filepath"
	"testing"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// Open opens a migrated database in a new t.TempDir() and returns its handle.
// Code not yet converted to take a handle reads sqlitex.DB, so Open sets that
// to the same handle. When the test ends the database is closed and the
// previous sqlitex.DB restored, so tests using it must not run in parallel.
func Open(t testing.TB) *gorm.DB {
	t.Helper()
	// TempDir registers its removal now, so it runs after the close below.
	path := filepath.Join(t.TempDir(), "enx.db")
	previous := sqlitex.DB
	t.Cleanup(func() { sqlitex.DB = previous })
	db, err := sqlitex.InitWithLogLevel(path, "warn")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			err = sqlDB.Close()
		}
		if err != nil {
			t.Errorf("close test database: %v", err)
		}
	})
	return db
}
