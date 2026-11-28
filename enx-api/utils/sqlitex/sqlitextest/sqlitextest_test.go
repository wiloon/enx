package sqlitextest_test

import (
	"testing"

	"enx-api/utils/sqlitex"
	"enx-api/utils/sqlitex/sqlitextest"

	"gorm.io/gorm"
)

// databaseFile is the file the handle's main database lives in.
func databaseFile(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var file string
	if err := db.Raw("SELECT file FROM pragma_database_list WHERE name = 'main'").Scan(&file).Error; err != nil {
		t.Fatal(err)
	}
	if file == "" {
		t.Fatal("the handle has no database file")
	}
	return file
}

func TestOpenGivesEachCallItsOwnMigratedDatabase(t *testing.T) {
	first := sqlitextest.Open(t)
	second := sqlitextest.Open(t)

	if a, b := databaseFile(t, first), databaseFile(t, second); a == b {
		t.Fatalf("both handles use %s", a)
	}
	if !first.Migrator().HasTable(&sqlitex.User{}) {
		t.Error("the database is not migrated")
	}
	if sqlitex.DB != second {
		t.Error("sqlitex.DB is not the handle last returned")
	}
}

func TestOpenRestoresThePreviousGlobalAndClosesTheHandle(t *testing.T) {
	before := sqlitextest.Open(t)

	var inner *gorm.DB
	t.Run("opens another", func(t *testing.T) {
		inner = sqlitextest.Open(t)
	})

	if sqlitex.DB != before {
		t.Error("sqlitex.DB was not restored")
	}
	if err := inner.Exec("SELECT 1").Error; err == nil {
		t.Error("the handle is still open after its test ended")
	}
}
