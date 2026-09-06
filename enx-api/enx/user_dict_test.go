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

func TestUserDictSaveThenIsExist(t *testing.T) {
	newUserDictTestDB(t)

	ud := UserDict{UserId: "u1", WordId: "w1", QueryCount: 3, AlreadyAcquainted: 1}
	ud.Save()

	reloaded := UserDict{UserId: "u1", WordId: "w1"}
	if !reloaded.IsExist() {
		t.Fatal("expected IsExist to be true after Save")
	}
	if reloaded.QueryCount != 3 {
		t.Errorf("QueryCount = %d, want 3", reloaded.QueryCount)
	}
	if reloaded.AlreadyAcquainted != 1 {
		t.Errorf("AlreadyAcquainted = %d, want 1", reloaded.AlreadyAcquainted)
	}
}

func TestUserDictUpdateQueryCount(t *testing.T) {
	newUserDictTestDB(t)

	ud := UserDict{UserId: "u1", WordId: "w1", QueryCount: 1}
	ud.Save()

	ud.QueryCount = 7
	ud.UpdateQueryCount()

	reloaded := UserDict{UserId: "u1", WordId: "w1"}
	reloaded.IsExist()
	if reloaded.QueryCount != 7 {
		t.Errorf("QueryCount = %d, want 7 after UpdateQueryCount", reloaded.QueryCount)
	}
}

func TestUserDictMarkTogglesAcquainted(t *testing.T) {
	newUserDictTestDB(t)

	ud := UserDict{UserId: "u1", WordId: "w1"}
	// No existing record: Mark should create one as acquainted.
	ud.Mark()
	if ud.AlreadyAcquainted != 1 {
		t.Fatalf("AlreadyAcquainted = %d, want 1 after first Mark", ud.AlreadyAcquainted)
	}

	// Existing acquainted record: Mark should toggle it back off.
	ud2 := UserDict{UserId: "u1", WordId: "w1"}
	ud2.Mark()
	if ud2.AlreadyAcquainted != 0 {
		t.Fatalf("AlreadyAcquainted = %d, want 0 after second Mark", ud2.AlreadyAcquainted)
	}

	// Regression guard: IsExist used to infer "no record" purely from
	// QueryCount==0 && AlreadyAcquainted==0, which is exactly the state this
	// row is now in even though Mark() just persisted it. repo.GetUserWordQueryCount
	// now reports existence explicitly via its found return value instead of
	// guessing from field values, so this must be true.
	reloaded := UserDict{UserId: "u1", WordId: "w1"}
	if !reloaded.IsExist() {
		t.Error("expected IsExist to report true for an existing 0/0 row")
	}

	var row repo.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", "u1", "w1").First(&row).Error; err != nil {
		t.Fatalf("expected the row to actually exist in the DB: %v", err)
	}
}
