package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

func markWordRequest(t *testing.T, userID, english string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/mark",
		strings.NewReader(`{"English":"`+english+`"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user_id", userID)
	MarkWord(c)
	return w
}

// A word with no row in `words` (e.g. one ECDICT doesn't know) has no id to
// key a user_dicts row on. Marking it must not write a user_dicts row with
// an empty word_id: every such word would share that one row, so marking a
// second unknown word toggled the first one's state back off, and the
// phantom row inflated the user's vocabulary total in /api/stats/overview.
func TestMarkWordNotInDictionaryWritesNoUserDictRow(t *testing.T) {
	if err := os.Setenv("DB_PATH", filepath.Join(t.TempDir(), "enx-mark.db")); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	gin.SetMode(gin.TestMode)

	userID := "u-" + t.Name()
	for _, english := range []string{"zzqxunknownone", "zzqxunknowntwo"} {
		if w := markWordRequest(t, userID, english); w.Code != http.StatusOK {
			t.Fatalf("mark %q: status %d, body %s", english, w.Code, w.Body.String())
		}
	}

	var count int64
	if err := sqlitex.DB.Model(&sqlitex.UserDict{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		t.Fatalf("count user_dicts: %v", err)
	}
	if count != 0 {
		t.Fatalf("user_dicts rows for user = %d, want 0", count)
	}
}

func TestMarkWordInDictionaryMarksAcquainted(t *testing.T) {
	if err := os.Setenv("DB_PATH", filepath.Join(t.TempDir(), "enx-mark.db")); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	gin.SetMode(gin.TestMode)

	wordID := "w-" + t.Name()
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: wordID, English: "zzqxknown", CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatalf("seed word: %v", err)
	}

	userID := "u-" + t.Name()
	if w := markWordRequest(t, userID, "zzqxknown"); w.Code != http.StatusOK {
		t.Fatalf("mark: status %d, body %s", w.Code, w.Body.String())
	}

	var ud sqlitex.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).First(&ud).Error; err != nil {
		t.Fatalf("load user_dicts row: %v", err)
	}
	if ud.AlreadyAcquainted != 1 {
		t.Fatalf("already_acquainted = %d, want 1", ud.AlreadyAcquainted)
	}
}
