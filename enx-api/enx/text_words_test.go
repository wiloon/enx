package enx

import (
	"context"
	"testing"

	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Characterization tests for the paragraph-init lookup: which keys come
// back for a paragraph, and each word's id and review state for the user.
// They pin behaviour before the per-word queries are batched.

// wordsIn runs the lookup under test over the real tables.
func wordsIn(t *testing.T, paragraph, userID string) map[string]Word {
	t.Helper()
	words, err := NewTextWords(RepoWordStates{}).In(context.Background(), paragraph, userID)
	if err != nil {
		t.Fatal(err)
	}
	return words
}

// newWordsTestDB points sqlitex.DB at a fresh in-memory words/user_dicts DB.
func newWordsTestDB(t *testing.T) *gorm.DB {
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

func seedTextWords(t *testing.T) {
	t.Helper()
	db := newWordsTestDB(t)
	deleted := int64(5)
	for _, w := range []repo.Word{
		{Id: "id-morning", English: "morning"},
		{Id: "id-assassins", English: "assassins"},
		{Id: "id-dog", English: "dog"},
		{Id: "id-US", English: "US"},
		{Id: "id-us", English: "us"},
		{Id: "id-b-Apple", English: "Apple"},
		{Id: "id-a-APPLE", English: "APPLE"},
		{Id: "id-gone", English: "gone", DeletedAt: &deleted},
		{Id: "id-well-known", English: "well-known"},
	} {
		w.CreatedAt, w.UpdatedAt = 1, 1
		if err := db.Create(&w).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, ud := range []repo.UserDict{
		{UserId: "u1", WordId: "id-morning", QueryCount: 4},
		{UserId: "u1", WordId: "id-dog", QueryCount: 2, AlreadyAcquainted: 1},
		{UserId: "u2", WordId: "id-assassins", QueryCount: 9, AlreadyAcquainted: 1},
	} {
		ud.CreatedAt, ud.UpdatedAt = 1, 1
		if err := db.Create(&ud).Error; err != nil {
			t.Fatal(err)
		}
	}
}

type wantWord struct {
	english, id           string
	loadCount, acquainted int
	wordType              int
}

func checkWords(t *testing.T, got map[string]Word, want map[string]wantWord) {
	t.Helper()
	if len(got) != len(want) {
		keys := []string{}
		for k := range got {
			keys = append(keys, k)
		}
		t.Fatalf("got %d keys %q, want %d", len(got), keys, len(want))
	}
	for key, w := range want {
		g, ok := got[key]
		if !ok {
			t.Errorf("missing key %q", key)
			continue
		}
		if g.English != w.english || g.Id != w.id || g.LoadCount != w.loadCount ||
			g.AlreadyAcquainted != w.acquainted || g.WordType != w.wordType || g.Raw != key {
			t.Errorf("key %q: got English=%q Id=%q LoadCount=%d Acquainted=%d WordType=%d Raw=%q; want %+v",
				key, g.English, g.Id, g.LoadCount, g.AlreadyAcquainted, g.WordType, g.Raw, w)
		}
		if g.Chinese != "" || g.Pronunciation != "" {
			t.Errorf("key %q: definition fields should stay empty, got %q / %q", key, g.Chinese, g.Pronunciation)
		}
	}
}

func TestWordsInReviewStatePerUser(t *testing.T) {
	seedTextWords(t)

	checkWords(t, wordsIn(t, "Good morning. (Assassins dog's", "u1"), map[string]wantWord{
		"Good":      {english: "Good"},
		"morning":   {english: "morning", id: "id-morning", loadCount: 4},
		"Assassins": {english: "Assassins", id: "id-assassins"},
		"dog's":     {english: "dog", id: "id-dog", loadCount: 2, acquainted: 1},
	})
	// Another user's review rows never leak.
	checkWords(t, wordsIn(t, "Assassins", "u2"), map[string]wantWord{
		"Assassins": {english: "Assassins", id: "id-assassins", loadCount: 9, acquainted: 1},
	})
}

func TestWordsInTokens(t *testing.T) {
	seedTextWords(t)

	checkWords(t, wordsIn(t, "their 6-year-old  well-known\n“sticky ——", "u1"), map[string]wantWord{
		"their":      {english: "their"},
		"6-year-old": {wordType: 1},
		"well-known": {english: "well-known", id: "id-well-known"},
		"sticky":     {english: "sticky"},
		"":           {},
	})
}

// An exact-case row wins; otherwise the case-insensitive match with the
// lowest id. Soft-deleted rows are invisible.
func TestWordsInCaseMatching(t *testing.T) {
	seedTextWords(t)

	checkWords(t, wordsIn(t, "US us Us apple gone", "u1"), map[string]wantWord{
		"US":    {english: "US", id: "id-US"},
		"us":    {english: "us", id: "id-us"},
		"Us":    {english: "Us", id: "id-US"},
		"apple": {english: "apple", id: "id-a-APPLE"},
		"gone":  {english: "gone"},
	})
}

func TestWordsInEmptyParagraph(t *testing.T) {
	seedTextWords(t)

	checkWords(t, wordsIn(t, "", "u1"), map[string]wantWord{})
}
