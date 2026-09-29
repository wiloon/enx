package enx

import (
	"testing"
	"time"

	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// newEcpTestDB spins up a fresh in-memory sqlite DB migrated for the repo
// package's Word/UserDict models, which is what ecp.go's Word methods read
// and write through.
func newEcpTestDB(t *testing.T) *gorm.DB {
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

func TestWordFindId(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.Word{Id: "id-hello", English: "hello", Chinese: "你好", Pronunciation: "/həˈloʊ/", LoadCount: 3, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	w := &Word{English: "hello"}
	w.FindId()
	if w.Id != "id-hello" {
		t.Errorf("Id = %q, want id-hello", w.Id)
	}
}

func TestWordFindIdNotFound(t *testing.T) {
	newEcpTestDB(t)

	w := &Word{English: "missing"}
	w.FindId()
	if w.Id != "" {
		t.Errorf("Id = %q, want empty for a word that doesn't exist", w.Id)
	}
}

func TestWordSaveAssignsIDAndPersists(t *testing.T) {
	db := newEcpTestDB(t)

	w := &Word{English: "newword", Chinese: "新词", Pronunciation: "/nu/", LoadCount: 1}
	if err := w.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if w.Id == "" {
		t.Fatal("expected Save to assign an Id")
	}

	var row repo.Word
	if err := db.Where("id = ?", w.Id).First(&row).Error; err != nil {
		t.Fatalf("expected the word to be persisted: %v", err)
	}
	if row.Chinese != "新词" {
		t.Errorf("Chinese = %q, want 新词", row.Chinese)
	}
}

func TestWordSaveStoresMillisecondTimestamps(t *testing.T) {
	db := newEcpTestDB(t)

	before := time.Now().UnixMilli()
	w := &Word{English: "stamped"}
	if err := w.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}
	after := time.Now().UnixMilli()

	var row repo.Word
	if err := db.Where("id = ?", w.Id).First(&row).Error; err != nil {
		t.Fatalf("expected the word to be persisted: %v", err)
	}
	if row.CreatedAt < before || row.CreatedAt > after {
		t.Errorf("created_at = %d, want Unix ms in [%d, %d]", row.CreatedAt, before, after)
	}
	if row.UpdatedAt < before || row.UpdatedAt > after {
		t.Errorf("updated_at = %d, want Unix ms in [%d, %d]", row.UpdatedAt, before, after)
	}
}

func TestWordSaveDuplicateEnglishReturnsErrorAndKeepsIdEmpty(t *testing.T) {
	db := newEcpTestDB(t)

	if err := (&Word{English: "dup"}).Save(); err != nil {
		t.Fatalf("first Save: %v", err)
	}
	w := &Word{English: "dup"}
	if err := w.Save(); err == nil {
		t.Fatal("expected the second Save to fail on the unique constraint")
	}
	if w.Id != "" {
		t.Errorf("Id = %q, want empty: the row was never persisted", w.Id)
	}

	var n int64
	db.Model(&repo.Word{}).Where("english = ?", "dup").Count(&n)
	if n != 1 {
		t.Errorf("rows = %d, want 1", n)
	}
}

func TestWordFindQueryCount(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.UserDict{UserId: "u1", WordId: "w1", QueryCount: 5, AlreadyAcquainted: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	w := &Word{Id: "w1"}
	got := w.FindQueryCount("u1")
	if got != 5 {
		t.Errorf("FindQueryCount() = %d, want 5", got)
	}
	if w.LoadCount != 5 {
		t.Errorf("LoadCount = %d, want 5", w.LoadCount)
	}
	if w.AlreadyAcquainted != 1 {
		t.Errorf("AlreadyAcquainted = %d, want 1", w.AlreadyAcquainted)
	}
}
