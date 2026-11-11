package adapters

import (
	"context"
	"testing"
	"time"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupLookupEventsDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.LookupEvent{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func TestLookupEventsAddStoresTheEvent(t *testing.T) {
	setupLookupEventsDB(t)
	at := time.Date(2026, 10, 15, 12, 0, 0, 123_000_000, time.UTC)

	err := LookupEvents{}.Add(context.Background(), dictionary.LookupEvent{
		UserID: "u1", At: at, TZOffsetMinutes: 480, Outcome: dictionary.OutcomeAllowed,
	})
	if err != nil {
		t.Fatal(err)
	}

	var rows []sqlitex.LookupEvent
	sqlitex.DB.Find(&rows)
	want := sqlitex.LookupEvent{UserID: "u1", At: at.UnixMilli(), TZOffsetMinutes: 480, Outcome: "allowed"}
	if len(rows) != 1 || rows[0] != want {
		t.Fatalf("rows %+v, want [%+v]", rows, want)
	}
}
