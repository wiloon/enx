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

func TestWordFindIdAndLoadByEnglish(t *testing.T) {
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

	w2 := &Word{English: "hello"}
	w2.LoadByEnglish()
	if w2.Chinese != "你好" {
		t.Errorf("Chinese = %q, want 你好", w2.Chinese)
	}
	if w2.LoadCount != 3 {
		t.Errorf("LoadCount = %d, want 3", w2.LoadCount)
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

func TestWordCountByEnglish(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.Word{Id: "id-1", English: "hello", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	w := &Word{English: "hello"}
	if got := w.CountByEnglish(); got != 1 {
		t.Errorf("CountByEnglish() = %d, want 1", got)
	}
}

func TestWordSaveAssignsIDAndPersists(t *testing.T) {
	db := newEcpTestDB(t)

	w := &Word{English: "newword", Chinese: "新词", Pronunciation: "/nu/", LoadCount: 1}
	w.Save()

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

func TestWordFindLoadCountById(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.Word{Id: "id-1", English: "hello", LoadCount: 42, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	w := &Word{Id: "id-1"}
	if got := w.FindLoadCountById(); got != 42 {
		t.Errorf("FindLoadCountById() = %d, want 42", got)
	}
}

func TestWordTranslateEmptyUserId(t *testing.T) {
	newEcpTestDB(t)

	w := &Word{English: "hello"}
	got := w.Translate("")
	if got != w {
		t.Error("expected Translate to return the same *Word when userId is empty")
	}
	if got.Id != "" {
		t.Error("expected no lookup to happen when userId is empty")
	}
}

func TestWordTranslateFindsWordAndUsesUserQueryCount(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.Word{Id: "id-hello", English: "hello", Chinese: "你好", LoadCount: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&repo.UserDict{UserId: "u1", WordId: "id-hello", QueryCount: 9, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	w := &Word{English: "hello"}
	got := w.Translate("u1")
	if got.Id != "id-hello" {
		t.Errorf("Id = %q, want id-hello", got.Id)
	}
	if got.Chinese != "你好" {
		t.Errorf("Chinese = %q, want 你好", got.Chinese)
	}
	// The per-user query count (9) should win over the word's global
	// LoadCount (1) once it's > 0.
	if got.LoadCount != 9 {
		t.Errorf("LoadCount = %d, want 9 (per-user query count)", got.LoadCount)
	}
}

func TestWordTranslateWordNotFound(t *testing.T) {
	newEcpTestDB(t)

	w := &Word{English: "missing"}
	got := w.Translate("u1")
	if got.Id != "" {
		t.Errorf("Id = %q, want empty for a word that doesn't exist", got.Id)
	}
}

func TestCheckAndMigrateQueryCountIsANoop(t *testing.T) {
	// Deprecated no-op: just confirm it doesn't panic.
	CheckAndMigrateQueryCount("some-word-id")
}
