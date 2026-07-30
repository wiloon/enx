package repo

import (
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestGetWordByEnglishExactBeforeCaseInsensitive(t *testing.T) {
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
	rows := []Word{
		{Id: "id-hello", English: "Hello", Chinese: "你好（大写）", CreatedAt: now, UpdatedAt: now},
		{Id: "id-world", English: "world", Chinese: "世界", CreatedAt: now, UpdatedAt: now},
	}
	for _, row := range rows {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}

	sqlitex.DB = db

	got := GetWordByEnglish("hello")
	if got.Id != "id-hello" {
		t.Fatalf("expected Hello via case-insensitive match, got id=%q english=%q", got.Id, got.English)
	}
	if got.Chinese != "你好（大写）" {
		t.Fatalf("chinese: %q", got.Chinese)
	}

	got = GetWordByEnglish("Hello")
	if got.Id != "id-hello" {
		t.Fatalf("expected exact Hello, got id=%q", got.Id)
	}
}
