package wordlist

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gin-gonic/gin"

	"enx-api/utils/sqlitex"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// get runs ListHandler behind a stand-in for middleware.ClerkAuth, which is
// what puts user_id on the context in production.
func get(t *testing.T, userID, query string) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	router.GET("/api/me/words", func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}, ListHandler)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/me/words"+query, nil))
	return w
}

type listJSON struct {
	Success bool  `json:"success"`
	Total   int64 `json:"total"`
	Words   []struct {
		English         string `json:"english"`
		Chinese         string `json:"chinese"`
		QueryCount      int    `json:"queryCount"`
		Known           bool   `json:"known"`
		FirstLookedUpAt string `json:"firstLookedUpAt"`
		UpdatedAt       string `json:"updatedAt"`
	} `json:"words"`
}

func TestListHandlerReturnsTheFilteredPageAndTotal(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wlh-learning", chinese: "学", count: 2, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "wlh-known", chinese: "会", count: 9, known: true, createdAt: day, updatedAt: day})

	w := get(t, user, "?status=known")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body=%s, want 200", w.Code, w.Body.String())
	}
	var got listJSON
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, w.Body.String())
	}
	if !got.Success || got.Total != 1 || len(got.Words) != 1 {
		t.Fatalf("got %+v, want one known word", got)
	}
	word := got.Words[0]
	if word.English != "wlh-known" || word.Chinese != "会" || word.QueryCount != 9 || !word.Known {
		t.Fatalf("word = %+v", word)
	}
	if word.FirstLookedUpAt != "2026-10-01T09:00:00Z" || word.UpdatedAt != "2026-10-01T09:00:00Z" {
		t.Fatalf("times = %q / %q, want RFC 3339 UTC", word.FirstLookedUpAt, word.UpdatedAt)
	}
}

func TestListHandlerEncodesAnEmptyListAsAnArray(t *testing.T) {
	w := get(t, "u-"+t.Name(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	if body := w.Body.String(); body != `{"success":true,"total":0,"words":[]}` {
		t.Fatalf("body = %s, want an empty words array", body)
	}
}

func TestListHandlerRejectsBadParameters(t *testing.T) {
	for _, query := range []string{"?status=mastered", "?limit=ten", "?offset=1.5"} {
		w := get(t, "u-"+t.Name(), query)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", query, w.Code)
		}
	}
}

// remove runs RemoveHandler the way get runs ListHandler.
func remove(t *testing.T, userID, english string) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	router.DELETE("/api/me/words/:english", func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}, RemoveHandler)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/me/words/"+url.PathEscape(english), nil))
	return w
}

func list(t *testing.T, userID string) listJSON {
	t.Helper()
	w := get(t, userID, "")
	var got listJSON
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, w.Body.String())
	}
	return got
}

func TestRemoveHandlerTakesTheWordOffTheList(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wlr-gone", count: 3, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "wlr-kept", count: 1, createdAt: day, updatedAt: day})

	if w := remove(t, user, "wlr-gone"); w.Code != http.StatusOK {
		t.Fatalf("status %d body=%s, want 200", w.Code, w.Body.String())
	}

	got := list(t, user)
	if got.Total != 1 || len(got.Words) != 1 || got.Words[0].English != "wlr-kept" {
		t.Fatalf("list after remove = %+v, want only wlr-kept", got)
	}
}

func TestRemoveHandlerLeavesOtherUsersAlone(t *testing.T) {
	me, other := "u-"+t.Name(), "u-other-"+t.Name()
	insert(t, me, seed{english: "wlr-shared", count: 2, createdAt: day, updatedAt: day})
	var word sqlitex.Word
	if err := sqlitex.DB.Where("english = ?", "wlr-shared").First(&word).Error; err != nil {
		t.Fatalf("find word: %v", err)
	}
	if err := sqlitex.DB.Create(&sqlitex.UserDict{
		UserId: other, WordId: word.Id, QueryCount: 5,
		CreatedAt: day.UnixMilli(), UpdatedAt: day.UnixMilli(),
	}).Error; err != nil {
		t.Fatalf("insert other user's row: %v", err)
	}

	if w := remove(t, me, "wlr-shared"); w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}

	got := list(t, other)
	if got.Total != 1 || got.Words[0].English != "wlr-shared" || got.Words[0].QueryCount != 5 {
		t.Fatalf("other user's list = %+v, want wlr-shared untouched", got)
	}
}

func TestRemoveHandlerMatchesTheWordInAnyCase(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wlr-ephemeral", count: 1, createdAt: day, updatedAt: day})

	if w := remove(t, user, "WLR-Ephemeral"); w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}

	if got := list(t, user); got.Total != 0 {
		t.Fatalf("list after remove = %+v, want empty", got)
	}
}

// A retried remove, or one for a word another tab already removed, is not an
// error: the word is off the list either way.
func TestRemoveHandlerSucceedsForAWordNotOnTheList(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wlr-twice", count: 1, createdAt: day, updatedAt: day})

	for _, english := range []string{"wlr-twice", "wlr-twice", "wlr-never-looked-up"} {
		if w := remove(t, user, english); w.Code != http.StatusOK {
			t.Fatalf("remove %q: status %d body=%s, want 200", english, w.Code, w.Body.String())
		}
	}
}
