package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

type knownResponse struct {
	English   string
	LoadCount int
	Known     bool
}

// knownRequest sends method (PUT or DELETE) to /api/me/words/:english/known
// as userID and returns the status and the decoded body.
func knownRequest(t *testing.T, method, userID, english string) (int, knownResponse) {
	t.Helper()
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", userID) })
	router.PUT("/api/me/words/:english/known", SetWordKnown)
	router.DELETE("/api/me/words/:english/known", ClearWordKnown)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(method, "/api/me/words/"+url.PathEscape(english)+"/known", nil))
	var resp knownResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("%s %q: decode %s: %v", method, english, w.Body.String(), err)
		}
	}
	return w.Code, resp
}

func setupKnownTest(t *testing.T) {
	t.Helper()
	sqlitex.Init(filepath.Join(t.TempDir(), "enx-known.db"))
	gin.SetMode(gin.TestMode)
}

func seedKnownWord(t *testing.T, english string) string {
	t.Helper()
	id := "w-" + t.Name() + "-" + english
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: id, English: english, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatalf("seed word: %v", err)
	}
	return id
}

// A retried PUT or DELETE (its first reply lost) must leave the word where
// the first one put it, and neither touches the lookup count.
func TestKnownPutAndDeleteAreIdempotent(t *testing.T) {
	setupKnownTest(t)
	userID := "u-" + t.Name()
	wordID := seedKnownWord(t, "zzqxknown")
	if err := sqlitex.DB.Create(&sqlitex.UserDict{UserId: userID, WordId: wordID, QueryCount: 5, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatalf("seed user_dict: %v", err)
	}

	steps := []struct {
		method string
		want   bool
	}{
		{http.MethodPut, true},
		{http.MethodPut, true},
		{http.MethodDelete, false},
		{http.MethodDelete, false},
		{http.MethodPut, true},
	}
	for i, s := range steps {
		code, resp := knownRequest(t, s.method, userID, "zzqxknown")
		if code != http.StatusOK || resp.Known != s.want || resp.LoadCount != 5 || resp.English != "zzqxknown" {
			t.Fatalf("step %d %s: status %d, response %+v; want known %v, LoadCount 5", i+1, s.method, code, resp, s.want)
		}
	}
}

// The path segment is the word as the user saw it; it resolves through the
// same case-insensitive lookup as the rest of the API, apostrophes included.
func TestKnownPutResolvesCaseAndApostrophe(t *testing.T) {
	setupKnownTest(t)
	userID := "u-" + t.Name()
	wordID := seedKnownWord(t, "don't")

	if code, resp := knownRequest(t, http.MethodPut, userID, "Don't"); code != http.StatusOK || !resp.Known {
		t.Fatalf("status %d, response %+v; want known", code, resp)
	}
	var ud sqlitex.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).First(&ud).Error; err != nil {
		t.Fatalf("load user_dicts row: %v", err)
	}
	if !ud.Known {
		t.Fatal("known not stored")
	}
}

// A word with no row in `words` (e.g. one ECDICT doesn't know) has no id to
// key a user_dicts row on. Writing one with an empty word_id would make every
// such word share that one row, and the phantom row would inflate the user's
// vocabulary total in /api/stats/overview. The request still succeeds.
func TestKnownWordNotInDictionaryWritesNoUserDictRow(t *testing.T) {
	setupKnownTest(t)
	userID := "u-" + t.Name()

	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		for _, english := range []string{"zzqxunknownone", "zzqxunknowntwo"} {
			if code, _ := knownRequest(t, method, userID, english); code != http.StatusOK {
				t.Fatalf("%s %q: status %d, want 200", method, english, code)
			}
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

func TestKnownWithoutSessionIsUnauthorized(t *testing.T) {
	setupKnownTest(t)
	seedKnownWord(t, "zzqxknown")

	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		if code, _ := knownRequest(t, method, "", "zzqxknown"); code != http.StatusUnauthorized {
			t.Errorf("%s without session: status %d, want 401", method, code)
		}
	}
}
