package repo

import (
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// newTestDB spins up a fresh in-memory sqlite DB migrated for this package's
// models and points sqlitex.DB at it, following the pattern established in
// ecp_lookup_test.go.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Word{}, &UserDict{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
	return db
}

func TestGetUserWordQueryCount(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()

	if err := db.Create(&UserDict{UserId: "u1", WordId: "w1", QueryCount: 4, AlreadyAcquainted: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	count, acquainted, found := GetUserWordQueryCount("w1", "u1")
	if !found {
		t.Error("found = false, want true")
	}
	if count != 4 {
		t.Errorf("count = %d, want 4", count)
	}
	if acquainted != 1 {
		t.Errorf("acquainted = %d, want 1", acquainted)
	}
}

func TestGetUserWordQueryCountExistingRowWithZeroValues(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()

	// A legitimately existing row (e.g. a word just unmarked via
	// UserDict.Mark) can have both fields at zero -- found must still be
	// true, distinguishing it from a genuinely missing row.
	if err := db.Create(&UserDict{UserId: "u1", WordId: "w1", QueryCount: 0, AlreadyAcquainted: 0, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	_, _, found := GetUserWordQueryCount("w1", "u1")
	if !found {
		t.Error("found = false, want true for an existing 0/0 row")
	}
}

func TestGetUserWordQueryCountNotFound(t *testing.T) {
	newTestDB(t)

	count, acquainted, found := GetUserWordQueryCount("missing-word", "missing-user")
	if found {
		t.Error("found = true, want false")
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
	if acquainted != 0 {
		t.Errorf("acquainted = %d, want 0", acquainted)
	}
}

func TestUpsertUserDictCreatesWhenMissing(t *testing.T) {
	db := newTestDB(t)

	if err := UpsertUserDict("u1", "w1", 2, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var row UserDict
	if err := db.Where("user_id = ? AND word_id = ?", "u1", "w1").First(&row).Error; err != nil {
		t.Fatalf("expected row to be created: %v", err)
	}
	if row.QueryCount != 2 {
		t.Errorf("query_count = %d, want 2", row.QueryCount)
	}
	if row.CreatedAt == 0 {
		t.Error("expected created_at to be set")
	}
}

func TestUpsertUserDictUpdatesWhenExisting(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&UserDict{UserId: "u1", WordId: "w1", QueryCount: 1, AlreadyAcquainted: 0, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	if err := UpsertUserDict("u1", "w1", 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var row UserDict
	if err := db.Where("user_id = ? AND word_id = ?", "u1", "w1").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.QueryCount != 5 {
		t.Errorf("query_count = %d, want 5", row.QueryCount)
	}
	if row.AlreadyAcquainted != 1 {
		t.Errorf("already_acquainted = %d, want 1", row.AlreadyAcquainted)
	}

	// Updating must not create a second row for the same (user_id, word_id).
	var count int64
	db.Model(&UserDict{}).Where("user_id = ? AND word_id = ?", "u1", "w1").Count(&count)
	if count != 1 {
		t.Errorf("expected exactly 1 row after update, got %d", count)
	}
}

func TestTranslateFindsExistingWord(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "id-hello", English: "hello", Chinese: "你好", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	got := Translate("hello", "u1")
	if got.Id != "id-hello" {
		t.Errorf("Id = %q, want id-hello", got.Id)
	}
	if got.Chinese != "你好" {
		t.Errorf("Chinese = %q, want 你好", got.Chinese)
	}
}

func TestTranslateReturnsEmptyWordWhenNotFound(t *testing.T) {
	newTestDB(t)

	got := Translate("missing", "u1")
	if got.Id != "" {
		t.Errorf("expected an empty Word, got Id=%q", got.Id)
	}
}

func TestCountByEnglish(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "id-1", English: "Hello", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	if got := CountByEnglish("hello"); got != 1 {
		t.Errorf("CountByEnglish(hello) = %d, want 1 (case-insensitive)", got)
	}
	if got := CountByEnglish("nonexistent"); got != 0 {
		t.Errorf("CountByEnglish(nonexistent) = %d, want 0", got)
	}
}

func TestCountByEnglishExcludesDeleted(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	deletedAt := now
	if err := db.Create(&Word{Id: "id-1", English: "gone", CreatedAt: now, UpdatedAt: now, DeletedAt: &deletedAt}).Error; err != nil {
		t.Fatal(err)
	}

	if got := CountByEnglish("gone"); got != 0 {
		t.Errorf("CountByEnglish(gone) = %d, want 0 (soft-deleted)", got)
	}
}

func TestWordAndUserDictTableNames(t *testing.T) {
	if got := (Word{}).TableName(); got != "words" {
		t.Errorf("Word.TableName() = %q, want words", got)
	}
	if got := (UserDict{}).TableName(); got != "user_dicts" {
		t.Errorf("UserDict.TableName() = %q, want user_dicts", got)
	}
}
