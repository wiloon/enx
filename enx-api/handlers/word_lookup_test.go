package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

type wordLookupResponse struct {
	QueryCount        int `json:"queryCount"`
	AlreadyAcquainted int `json:"alreadyAcquainted"`
}

// postWordLookup sends POST /api/me/word-lookups with body as userID and
// returns the status and the decoded body.
func postWordLookup(t *testing.T, userID, body string) (int, wordLookupResponse) {
	t.Helper()
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", userID) })
	router.POST("/api/me/word-lookups", RecordWordLookup)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/me/word-lookups", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)
	var resp wordLookupResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode %s: %v", w.Body.String(), err)
		}
	}
	return w.Code, resp
}

func recordLookupOf(t *testing.T, userID, wordID string) wordLookupResponse {
	t.Helper()
	code, resp := postWordLookup(t, userID, `{"wordId":"`+wordID+`"}`)
	if code != http.StatusOK {
		t.Fatalf("POST lookup of %s: got %d, want 200", wordID, code)
	}
	return resp
}

func seedReview(t *testing.T, userID, wordID string, queryCount, acquainted int) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.UserDict{
		UserId: userID, WordId: wordID, QueryCount: queryCount,
		AlreadyAcquainted: acquainted, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed user_dict: %v", err)
	}
}

func reviewOf(t *testing.T, userID, wordID string) (queryCount, acquainted int, found bool) {
	t.Helper()
	var rows []sqlitex.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return 0, 0, false
	}
	return rows[0].QueryCount, rows[0].AlreadyAcquainted, true
}

func TestWordLookupFirstTimeStartsTheQueryCountAtOne(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	resp := recordLookupOf(t, "u1", id)

	if resp.QueryCount != 1 || resp.AlreadyAcquainted != 0 {
		t.Fatalf("response %+v, want queryCount 1, not known", resp)
	}
	if qc, ac, _ := reviewOf(t, "u1", id); qc != 1 || ac != 0 {
		t.Fatalf("user_dicts %d/%d, want 1/0", qc, ac)
	}
}

func TestWordLookupKeepsAccumulating(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u1", id, 3, 0)

	recordLookupOf(t, "u1", id)
	resp := recordLookupOf(t, "u1", id)

	if resp.QueryCount != 5 {
		t.Fatalf("queryCount %d, want 5", resp.QueryCount)
	}
}

// A known word looked up again goes back into review; its count carries on
// and is never reset (ADR-059 Decision 3).
func TestWordLookupOfAKnownWordClearsKnownAndKeepsTheCount(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u1", id, 7, 1)

	resp := recordLookupOf(t, "u1", id)

	if resp.QueryCount != 8 || resp.AlreadyAcquainted != 0 {
		t.Fatalf("response %+v, want queryCount 8, not known", resp)
	}
}

func TestWordLookupOnlyTouchesTheCallersRow(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u2", id, 7, 1)

	recordLookupOf(t, "u1", id)

	if qc, ac, _ := reviewOf(t, "u2", id); qc != 7 || ac != 1 {
		t.Fatalf("another user's row %d/%d, want 7/1 untouched", qc, ac)
	}
}

func TestWordLookupOfAnUnknownWordIs404(t *testing.T) {
	setupKnownTest(t)

	code, _ := postWordLookup(t, "u1", `{"wordId":"no-such-word"}`)

	if code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", code)
	}
	if _, _, found := reviewOf(t, "u1", "no-such-word"); found {
		t.Fatal("a user_dicts row was written for a word that does not exist")
	}
}

func TestWordLookupRejectsARequestWithoutAWordID(t *testing.T) {
	setupKnownTest(t)

	for _, body := range []string{`{}`, `{"wordId":""}`, `not json`} {
		if code, _ := postWordLookup(t, "u1", body); code != http.StatusBadRequest {
			t.Errorf("body %s: got %d, want 400", body, code)
		}
	}
}

// Recording a lookup is not a lookup request: no quota, no lookup event
// (ADR-059 Decision 3).
func TestWordLookupWritesNoLookupEvent(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	recordLookupOf(t, "u1", id)

	var n int64
	sqlitex.DB.Model(&sqlitex.LookupEvent{}).Count(&n)
	if n != 0 {
		t.Fatalf("%d lookup events, want 0", n)
	}
}

func TestWordLookupRejectsAnUnauthenticatedRequest(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	if code, _ := postWordLookup(t, "", `{"wordId":"`+id+`"}`); code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", code)
	}
}
