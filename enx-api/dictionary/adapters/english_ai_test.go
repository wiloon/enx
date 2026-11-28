package adapters

import (
	"context"
	"testing"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupEnglishAIDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&sqlitex.AIEnglishDefinition{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func TestAIEnglishDefinitionsKeepsTheFirstRowOnConflict(t *testing.T) {
	setupEnglishAIDB(t)
	ctx := context.Background()
	store := AIEnglishDefinitions{}
	first := dictionary.EnglishAIRow{
		WordID: "w1", Quality: 9, PromptVersion: "v1",
		Senses: []dictionary.Sense{{POS: "noun", Gloss: "First.", Example: "The first."}},
	}
	second := dictionary.EnglishAIRow{
		WordID: "w1", Quality: 3, PromptVersion: "v2",
		Senses: []dictionary.Sense{{POS: "noun", Gloss: "Second.", Example: "The second."}},
	}
	inserted, err := store.Insert(ctx, first)
	if err != nil || !inserted {
		t.Fatalf("first insert: inserted=%v err=%v", inserted, err)
	}
	inserted, err = store.Insert(ctx, second)
	if err != nil || inserted {
		t.Fatalf("second insert: inserted=%v err=%v, want kept first", inserted, err)
	}
	got, ok, err := store.Find(ctx, "w1")
	if err != nil || !ok {
		t.Fatalf("find: ok=%v err=%v", ok, err)
	}
	if got.Quality != 9 || got.PromptVersion != "v1" || got.Senses[0].Gloss != "First." {
		t.Fatalf("got %+v, want the first row", got)
	}
}
