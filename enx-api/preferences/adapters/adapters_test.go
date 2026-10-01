package adapters

import (
	"context"
	"testing"

	"enx-api/preferences"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.UserPreference{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func TestTableSaveLoadClear(t *testing.T) {
	setupDB(t)
	ctx := context.Background()
	tbl := Table{}

	if got, err := tbl.Load(ctx, "u1"); err != nil || len(got) != 0 {
		t.Fatalf("empty Load = %v, %v", got, err)
	}
	if err := tbl.Save(ctx, "u1", preferences.AIWordFallback, true); err != nil {
		t.Fatal(err)
	}
	// Saving again overwrites rather than failing on the primary key.
	if err := tbl.Save(ctx, "u1", preferences.AIWordFallback, false); err != nil {
		t.Fatal(err)
	}
	if err := tbl.Save(ctx, "u2", preferences.AIWordFallback, true); err != nil {
		t.Fatal(err)
	}

	got, err := tbl.Load(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[preferences.AIWordFallback] {
		t.Fatalf("u1 Load = %v, want only an explicit false", got)
	}

	if err := tbl.Clear(ctx, "u1", preferences.AIWordFallback); err != nil {
		t.Fatal(err)
	}
	if got, _ := tbl.Load(ctx, "u1"); len(got) != 0 {
		t.Fatalf("Load after Clear = %v, want empty", got)
	}
	if got, _ := tbl.Load(ctx, "u2"); !got[preferences.AIWordFallback] {
		t.Fatal("clearing u1 must not touch u2")
	}
	if err := tbl.Clear(ctx, "u1", preferences.AIWordFallback); err != nil {
		t.Fatalf("clearing a missing key: %v", err)
	}
}

func TestTableLoadSkipsNonBooleanValues(t *testing.T) {
	setupDB(t)
	if err := sqlitex.DB.Create(&sqlitex.UserPreference{
		UserId: "u1", Key: "aiWordFallback", Value: `"yes"`, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	got, err := Table{}.Load(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("Load = %v, want the malformed row treated as unset", got)
	}
}
