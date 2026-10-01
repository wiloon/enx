package repo

import (
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// ADR-043: one row per word whatever its case; a curly apostrophe finds the
// straight one. One indexed query, no exact-then-LOWER fallback.
func TestGetWordByEnglishAnyCaseAndApostrophe(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Word{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	for _, row := range []Word{
		{Id: "id-hello", English: "Hello", Chinese: "你好", CreatedAt: now, UpdatedAt: now},
		{Id: "id-dont", English: "don't", Chinese: "不要", CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	sqlitex.DB = db

	for english, want := range map[string]string{
		"Hello": "id-hello", "hello": "id-hello", "HELLO": "id-hello",
		"don't": "id-dont", "don’t": "id-dont", "DON’T": "id-dont",
		"world": "",
	} {
		if got := GetWordByEnglish(english); got.Id != want {
			t.Errorf("GetWordByEnglish(%q) = %q, want %q", english, got.Id, want)
		}
	}
}

func TestCanonicalEnglish(t *testing.T) {
	for in, want := range map[string]string{"don’t": "don't", "don't": "don't", "rock’n’roll": "rock'n'roll", "Hello": "Hello"} {
		if got := CanonicalEnglish(in); got != want {
			t.Errorf("CanonicalEnglish(%q) = %q, want %q", in, got, want)
		}
	}
}
