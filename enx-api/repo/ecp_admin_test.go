package repo

import (
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

func TestAdminGetWordIncludesSoftDeletedRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	del := now - 1000

	if err := db.Create(&Word{Id: "w-live", English: "hello", Chinese: "你好", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&Word{Id: "w-dead", English: "goodbye", Chinese: "再见", CreatedAt: now, UpdatedAt: now, DeletedAt: &del}).Error; err != nil {
		t.Fatal(err)
	}

	if row, found := AdminGetWord("hello"); !found || row.Id != "w-live" {
		t.Fatalf("live row: found=%v row=%+v", found, row)
	}
	// GetWordByEnglish would filter this out; AdminGetWord must not.
	row, found := AdminGetWord("goodbye")
	if !found || row.Id != "w-dead" || row.DeletedAt == nil {
		t.Fatalf("soft-deleted row: found=%v row=%+v", found, row)
	}
	if _, found := AdminGetWord("missing"); found {
		t.Fatal("expected not found for a word absent from the table")
	}
}

func TestAdminGetWordCaseInsensitiveFallback(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w1", English: "Hello", Chinese: "你好", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if row, found := AdminGetWord("hello"); !found || row.Id != "w1" {
		t.Fatalf("case-insensitive: found=%v row=%+v", found, row)
	}
}

func TestAdminSyncWordFromEcdictCreatesWhenAbsent(t *testing.T) {
	newTestDB(t)

	row, err := AdminSyncWordFromEcdict("serendipity", "意外发现珍奇事物的能力", "/ˌserənˈdipəti/")
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if row.Id == "" || row.English != "serendipity" || row.Chinese != "意外发现珍奇事物的能力" || row.LoadCount != 0 {
		t.Fatalf("created row = %+v", row)
	}
	if row.CreatedAt == 0 || row.UpdatedAt == 0 {
		t.Fatalf("timestamps not set: %+v", row)
	}

	got, found := AdminGetWord("serendipity")
	if !found || got.Chinese != "意外发现珍奇事物的能力" {
		t.Fatalf("persisted row = %+v found=%v", got, found)
	}
}

func TestAdminSyncWordFromEcdictOverwritesExistingRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w1", English: "run", Chinese: "旧释义", Pronunciation: "old", LoadCount: 7, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	row, err := AdminSyncWordFromEcdict("run", "跑；奔跑", "/rʌn/")
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if row.Id != "w1" || row.Chinese != "跑；奔跑" || row.Pronunciation != "/rʌn/" {
		t.Fatalf("updated row = %+v", row)
	}
	// load_count and identity are preserved -- only chinese/pronunciation change.
	if row.LoadCount != 7 {
		t.Fatalf("load_count = %d, want 7 (preserved)", row.LoadCount)
	}

	got, _ := AdminGetWord("run")
	if got.Chinese != "跑；奔跑" || got.LoadCount != 7 {
		t.Fatalf("persisted = %+v", got)
	}

	// Syncing onto a soft-deleted row revives it (deleted_at cleared).
	del := now - 5000
	if err := db.Model(&Word{}).Where("id = ?", "w1").Update("deleted_at", &del).Error; err != nil {
		t.Fatal(err)
	}
	revived, err := AdminSyncWordFromEcdict("run", "跑", "/rʌn/")
	if err != nil {
		t.Fatalf("sync onto tombstone: %v", err)
	}
	if revived.DeletedAt != nil {
		t.Fatalf("expected deleted_at cleared, got %v", *revived.DeletedAt)
	}

	// Idempotent: a second identical sync leaves the same single row.
	if _, err := AdminSyncWordFromEcdict("run", "跑；奔跑", "/rʌn/"); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	var count int64
	sqlitex.DB.Model(&Word{}).Where("LOWER(english) = LOWER(?)", "run").Count(&count)
	if count != 1 {
		t.Fatalf("row count = %d, want 1", count)
	}
}
