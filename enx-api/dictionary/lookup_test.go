package dictionary

import (
	"context"
	"errors"
	"testing"

	"enx-api/ecdict"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.Word{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func TestLookupReturnsUnavailableWhenEcdictMissing(t *testing.T) {
	setupTestDB(t)
	ecdict.Init("")
	_, err := Lookup(context.Background(), "unknownword")
	if !errors.Is(err, ErrEcdictUnavailable) {
		t.Fatalf("expected ErrEcdictUnavailable, got %v", err)
	}
}
