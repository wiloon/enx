package enx

import (
	"testing"

	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// newUserDictTestDB spins up a fresh in-memory sqlite DB migrated for the
// repo package's models (UserDict.Save/UpdateQueryCount/Mark/IsExist all go
// through repo.UpsertUserDict / repo.GetUserWordQueryCount) and points
// sqlitex.DB at it, following the pattern used in repo/ecp_lookup_test.go.
func newUserDictTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&repo.Word{}, &repo.UserDict{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
	return db
}

func TestUserDictIsExistFalseWhenMissing(t *testing.T) {
	newUserDictTestDB(t)

	ud := UserDict{UserId: "u1", WordId: "w1"}
	if ud.IsExist() {
		t.Error("expected IsExist to be false for a missing record")
	}
}

func TestUserDictIsExist(t *testing.T) {
	db := newUserDictTestDB(t)

	if err := db.Create(&repo.UserDict{UserId: "u1", WordId: "w1", QueryCount: 3, AlreadyAcquainted: 1, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}

	reloaded := UserDict{UserId: "u1", WordId: "w1"}
	if !reloaded.IsExist() {
		t.Fatal("expected IsExist to be true for a stored row")
	}
	if reloaded.QueryCount != 3 {
		t.Errorf("QueryCount = %d, want 3", reloaded.QueryCount)
	}
	if reloaded.AlreadyAcquainted != 1 {
		t.Errorf("AlreadyAcquainted = %d, want 1", reloaded.AlreadyAcquainted)
	}
}
