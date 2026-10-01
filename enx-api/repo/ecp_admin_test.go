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

// seedAIWord adds an AI-made words row, with one user_dicts row per entry of
// lookups (each value is that user's query_count).
func seedAIWord(t *testing.T, id, english string, createdAt int64, editedAt *int64, lookups ...int) {
	t.Helper()
	db := sqlitex.DB
	quality, version := 9, "v1"
	if err := db.Create(&Word{
		Id: id, English: english, Chinese: "n. " + english, Source: WordSourceAI,
		AIQuality: &quality, AIPromptVersion: &version,
		AdminEditedAt: editedAt, CreatedAt: createdAt, UpdatedAt: createdAt,
	}).Error; err != nil {
		t.Fatal(err)
	}
	for i, count := range lookups {
		if err := db.Create(&UserDict{UserId: english + string(rune('a'+i)), WordId: id, QueryCount: count, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestAdminWordUsageCountsUsersAndLookups(t *testing.T) {
	newTestDB(t)
	seedAIWord(t, "w1", "rizzler", 1, nil, 3, 5, 1)

	usage, err := AdminWordUsage("w1")
	if err != nil {
		t.Fatal(err)
	}
	if usage != (WordUsage{Users: 3, Lookups: 9}) {
		t.Fatalf("usage = %+v, want 3 users and 9 lookups", usage)
	}
	// A word nobody has looked up is not an error.
	if usage, err := AdminWordUsage("nobody"); err != nil || usage != (WordUsage{}) {
		t.Fatalf("usage of an unused word = %+v, %v", usage, err)
	}
}

func TestAdminListAIWordsIsTheUnreviewedQueueBusiestFirst(t *testing.T) {
	newTestDB(t)
	edited := time.Now().UnixMilli()
	seedAIWord(t, "w-quiet", "quiet", 300, nil)                // no users
	seedAIWord(t, "w-busy", "busy", 100, nil, 4, 4, 4)         // 3 users, 12 lookups
	seedAIWord(t, "w-heavy", "heavy", 200, nil, 50)            // 1 user, 50 lookups
	seedAIWord(t, "w-wide", "wide", 150, nil, 1, 1, 1)         // 3 users, 3 lookups
	seedAIWord(t, "w-reviewed", "reviewed", 50, &edited, 9, 9) // already reviewed: not in the queue
	if err := sqlitex.DB.Create(&Word{Id: "w-ecdict", English: "plain", Chinese: "平常", Source: WordSourceECDICT, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	gone := edited
	if err := sqlitex.DB.Create(&Word{Id: "w-gone", English: "gone", Chinese: "没了", Source: WordSourceAI, CreatedAt: 1, UpdatedAt: 1, DeletedAt: &gone}).Error; err != nil {
		t.Fatal(err)
	}

	rows, total, err := AdminListAIWords(false, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range rows {
		got = append(got, r.Id)
	}
	// Most users first, then most lookups, then newest.
	want := []string{"w-busy", "w-wide", "w-heavy", "w-quiet"}
	if len(got) != len(want) || total != int64(len(want)) {
		t.Fatalf("queue = %v (total %d), want %v", got, total, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("queue = %v, want %v", got, want)
		}
	}
	if rows[0].Users != 3 || rows[0].Lookups != 12 || rows[0].Word.AIQuality == nil || *rows[0].Word.AIQuality != 9 {
		t.Fatalf("first row = %+v, want its usage and provenance filled in", rows[0])
	}
}

func TestAdminListAIWordsReviewedListsOnlyEditedRows(t *testing.T) {
	newTestDB(t)
	edited := time.Now().UnixMilli()
	seedAIWord(t, "w-open", "open", 1, nil)
	seedAIWord(t, "w-done", "done", 2, &edited)

	rows, total, err := AdminListAIWords(true, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Id != "w-done" || total != 1 {
		t.Fatalf("reviewed = %+v (total %d), want only w-done", rows, total)
	}
	if rows[0].AdminEditedAt == nil {
		t.Fatal("a reviewed row should carry when it was edited")
	}
}

func TestAdminListAIWordsPagesAndTotalCountsEverything(t *testing.T) {
	newTestDB(t)
	for i, name := range []string{"aa", "bb", "cc", "dd", "ee"} {
		seedAIWord(t, "w-"+name, name, int64(i+1), nil)
	}

	first, total, err := AdminListAIWords(false, 2, 0)
	if err != nil || len(first) != 2 || total != 5 {
		t.Fatalf("page 1 = %d rows, total %d, %v; want 2 rows of 5", len(first), total, err)
	}
	last, _, err := AdminListAIWords(false, 2, 4)
	if err != nil || len(last) != 1 {
		t.Fatalf("last page = %d rows, %v; want 1", len(last), err)
	}
	if first[0].Id == last[0].Id || first[1].Id == last[0].Id {
		t.Fatal("pages overlap")
	}
	beyond, total, err := AdminListAIWords(false, 2, 50)
	if err != nil || len(beyond) != 0 || total != 5 {
		t.Fatalf("beyond the end = %d rows, total %d, %v", len(beyond), total, err)
	}
}
