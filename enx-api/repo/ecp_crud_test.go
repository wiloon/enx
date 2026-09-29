package repo

import (
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// newTestDB spins up a fresh in-memory sqlite DB migrated for this package's
// models and points sqlitex.DB at it, following the pattern established in
// ecp_lookup_test.go.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Word{}, &UserDict{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
	return db
}

func TestGetUserWordQueryCount(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()

	if err := db.Create(&UserDict{UserId: "u1", WordId: "w1", QueryCount: 4, AlreadyAcquainted: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	count, acquainted, found := GetUserWordQueryCount("w1", "u1")
	if !found {
		t.Error("found = false, want true")
	}
	if count != 4 {
		t.Errorf("count = %d, want 4", count)
	}
	if acquainted != 1 {
		t.Errorf("acquainted = %d, want 1", acquainted)
	}
}

func TestGetUserWordQueryCountExistingRowWithZeroValues(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()

	// A legitimately existing row (e.g. a word just unmarked via
	// UserDict.Mark) can have both fields at zero -- found must still be
	// true, distinguishing it from a genuinely missing row.
	if err := db.Create(&UserDict{UserId: "u1", WordId: "w1", QueryCount: 0, AlreadyAcquainted: 0, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	_, _, found := GetUserWordQueryCount("w1", "u1")
	if !found {
		t.Error("found = false, want true for an existing 0/0 row")
	}
}

func TestGetUserWordQueryCountNotFound(t *testing.T) {
	newTestDB(t)

	count, acquainted, found := GetUserWordQueryCount("missing-word", "missing-user")
	if found {
		t.Error("found = true, want false")
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
	if acquainted != 0 {
		t.Errorf("acquainted = %d, want 0", acquainted)
	}
}

func TestWordAndUserDictTableNames(t *testing.T) {
	if got := (Word{}).TableName(); got != "words" {
		t.Errorf("Word.TableName() = %q, want words", got)
	}
	if got := (UserDict{}).TableName(); got != "user_dicts" {
		t.Errorf("UserDict.TableName() = %q, want user_dicts", got)
	}
}
