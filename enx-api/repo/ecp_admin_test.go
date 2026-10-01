package repo

import (
	"errors"
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

func TestAdminGetWordAnyCaseAndApostrophe(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w1", English: "Hello", Chinese: "你好", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if row, found := AdminGetWord("hello"); !found || row.Id != "w1" {
		t.Fatalf("case-insensitive: found=%v row=%+v", found, row)
	}
	if err := db.Create(&Word{Id: "w2", English: "don't", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if row, found := AdminGetWord("don’t"); !found || row.Id != "w2" {
		t.Fatalf("curly apostrophe: found=%v row=%+v", found, row)
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

func TestFindWordForLookupHidesUneditedAIRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	for _, w := range []Word{
		{Id: "w-ecdict", English: "serendipity", Chinese: "机缘巧合", Source: WordSourceECDICT},
		{Id: "w-ai", English: "rizzler", Chinese: "很有魅力的人", Source: WordSourceAI},
		{Id: "w-ai-edited", English: "doomscroll", Chinese: "刷坏消息", Source: WordSourceAI, AdminEditedAt: &now},
		{Id: "w-ecdict-edited", English: "gist", Chinese: "要点", Source: WordSourceECDICT, AdminEditedAt: &now},
	} {
		w.CreatedAt, w.UpdatedAt = now, now
		if err := db.Create(&w).Error; err != nil {
			t.Fatal(err)
		}
	}

	for _, tc := range []struct {
		word      string
		includeAI bool
		want      string // "" = not visible
	}{
		{"serendipity", false, "w-ecdict"},
		{"rizzler", false, ""},
		{"rizzler", true, "w-ai"},
		{"RIZZLER", true, "w-ai"},
		{"doomscroll", false, "w-ai-edited"},
		{"gist", false, "w-ecdict-edited"},
		{"missing", true, ""},
	} {
		if got := FindWordForLookup(tc.word, tc.includeAI).Id; got != tc.want {
			t.Errorf("FindWordForLookup(%q, includeAI=%v) = %q, want %q", tc.word, tc.includeAI, got, tc.want)
		}
	}
}

func TestFindWordForLookupSkipsSoftDeletedRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w1", English: "gone", Chinese: "没了", Source: WordSourceECDICT, CreatedAt: now, UpdatedAt: now, DeletedAt: &now}).Error; err != nil {
		t.Fatal(err)
	}
	if got := FindWordForLookup("gone", true).Id; got != "" {
		t.Fatalf("a soft-deleted row was found: %q", got)
	}
}

func TestAdminEditWordRecordsTheEditAndKeepsTheSource(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w-ai", English: "rizzler", Chinese: "旧释义", Pronunciation: "", Source: WordSourceAI, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if got := FindWordForLookup("rizzler", false).Id; got != "" {
		t.Fatal("precondition: an unedited AI row should be hidden")
	}

	row, err := AdminEditWord("Rizzler", "n. 很有魅力的人", "ˈrɪzlər")
	if err != nil {
		t.Fatal(err)
	}
	if row.Chinese != "n. 很有魅力的人" || row.Pronunciation != "ˈrɪzlər" {
		t.Fatalf("returned row = %+v", row)
	}
	if row.Source != WordSourceAI {
		t.Fatalf("Source = %q: an edit must not rewrite where the row came from", row.Source)
	}
	if row.AdminEditedAt == nil || *row.AdminEditedAt < now {
		t.Fatalf("AdminEditedAt = %v, want a time at or after the edit", row.AdminEditedAt)
	}

	var stored Word
	if err := db.Where("id = ?", "w-ai").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Chinese != "n. 很有魅力的人" || stored.Source != WordSourceAI || stored.AdminEditedAt == nil {
		t.Fatalf("stored row = %+v", stored)
	}
	// Editing is what releases an AI row to users who can't use AI.
	if got := FindWordForLookup("rizzler", false).Id; got != "w-ai" {
		t.Fatalf("after an admin edit the row should be visible to everyone, got %q", got)
	}
}

func TestAdminEditWordRefusesMissingAndDeletedRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w-dead", English: "goodbye", Chinese: "再见", Source: WordSourceECDICT, CreatedAt: now, UpdatedAt: now, DeletedAt: &now}).Error; err != nil {
		t.Fatal(err)
	}
	for _, word := range []string{"missing", "goodbye"} {
		if _, err := AdminEditWord(word, "x", ""); !errors.Is(err, ErrWordNotFound) {
			t.Errorf("AdminEditWord(%q) err = %v, want ErrWordNotFound", word, err)
		}
	}
}

func TestAdminSyncWordFromEcdictResetsToAPlainECDICTRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&Word{Id: "w1", English: "rizzler", Chinese: "AI 的释义", Source: WordSourceAI, AdminEditedAt: &now, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	row, err := AdminSyncWordFromEcdict("rizzler", "n. ECDICT 的释义", "ˈrɪzlər")
	if err != nil {
		t.Fatal(err)
	}
	if row.Source != WordSourceECDICT || row.AdminEditedAt != nil {
		t.Fatalf("row = %+v, want source ecdict and no recorded edit", row)
	}
	var stored Word
	if err := db.Where("id = ?", "w1").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Source != WordSourceECDICT || stored.AdminEditedAt != nil || stored.Chinese != "n. ECDICT 的释义" {
		t.Fatalf("stored row = %+v", stored)
	}
}

func TestAdminSyncWordFromEcdictCreatesAnECDICTRow(t *testing.T) {
	newTestDB(t)
	row, err := AdminSyncWordFromEcdict("fresh", "新的", "")
	if err != nil {
		t.Fatal(err)
	}
	if row.Source != WordSourceECDICT || row.AdminEditedAt != nil {
		t.Fatalf("row = %+v, want source ecdict and no recorded edit", row)
	}
}

func TestInsertWordFillsInWhatTheCallerLeavesOut(t *testing.T) {
	newTestDB(t)
	before := time.Now().UnixMilli()

	row := Word{English: "don’t", Chinese: "aux. 不要"}
	if err := InsertWord(&row); err != nil {
		t.Fatal(err)
	}
	if row.Id == "" {
		t.Fatal("the inserted row has no id")
	}
	if row.English != "don't" {
		t.Fatalf("English = %q, want the straight-apostrophe spelling", row.English)
	}
	if row.Source != WordSourceECDICT {
		t.Fatalf("Source = %q, want ecdict by default", row.Source)
	}
	if row.CreatedAt < before || row.UpdatedAt < before {
		t.Fatalf("timestamps %d/%d are not Unix milliseconds from now", row.CreatedAt, row.UpdatedAt)
	}
	if got := GetWordByEnglish("don't"); got.Id != row.Id {
		t.Fatalf("the row is not findable by its word: %+v", got)
	}
}

func TestInsertWordKeepsAnAISourceAndItsProvenance(t *testing.T) {
	newTestDB(t)
	quality, version := 9, "v1"

	row := Word{English: "rizzler", Chinese: "n. 很有魅力的人", Source: WordSourceAI, AIQuality: &quality, AIPromptVersion: &version}
	if err := InsertWord(&row); err != nil {
		t.Fatal(err)
	}
	stored := FindWordForLookup("rizzler", true)
	if stored.Source != WordSourceAI || stored.AIQuality == nil || *stored.AIQuality != 9 || *stored.AIPromptVersion != "v1" {
		t.Fatalf("stored row = %+v", stored)
	}
}

func TestInsertWordRefusesAWordThatIsAlreadyThere(t *testing.T) {
	newTestDB(t)
	if err := InsertWord(&Word{English: "Hello", Chinese: "你好"}); err != nil {
		t.Fatal(err)
	}

	again := Word{English: "hello", Chinese: "喂"}
	if err := InsertWord(&again); err == nil {
		t.Fatal("expected the UNIQUE constraint to refuse a second row for the same word, in any case")
	}
	if again.Id != "" {
		t.Fatalf("Id = %q: a caller must never hold an id that was not persisted", again.Id)
	}
}
