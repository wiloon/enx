package translate

import (
	"encoding/json"
	"net/http"
	"testing"

	"enx-api/ecdict"
	"enx-api/ecdict/ecdicttest"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Tests for the per-user review state translateWord answers with (#22):
// user_dicts.QueryCount drives the review bucket and so the underline colour
// in enx-chrome.

type stardictRow = ecdicttest.Row

// setupEcdictWith opens a throwaway on-disk stardict holding rows, so the
// ECDICT fallback returns real entries.
func setupEcdictWith(t *testing.T, rows ...stardictRow) {
	t.Helper()
	ecdict.Init(ecdicttest.Create(t, rows...))
	t.Cleanup(func() { ecdict.Init("") })
}

// setupReviewTest gives each test an empty in-memory DB, an ECDICT holding
// rows, and quota counting with no limit, so no lookup is ever 429'd.
func setupReviewTest(t *testing.T, rows ...stardictRow) {
	t.Helper()
	setupQuotaTestDB(t)
	setupEcdictWith(t, rows...)
	gin.SetMode(gin.TestMode)
}

func seedWord(t *testing.T, english string) string {
	t.Helper()
	zh := "释义"
	id := uuid.NewString()
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: id, English: english, Chinese: &zh, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed word %q: %v", english, err)
	}
	return id
}

func seedUserDict(t *testing.T, userID, wordID string, queryCount, acquainted int) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.UserDict{
		UserId: userID, WordId: wordID, QueryCount: queryCount,
		AlreadyAcquainted: acquainted, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed user_dict: %v", err)
	}
}

// userDictRow returns the user's row for wordID; found is false when none exists.
func userDictRow(t *testing.T, userID, wordID string) (row sqlitex.UserDict, found bool) {
	t.Helper()
	var rows []sqlitex.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return sqlitex.UserDict{}, false
	}
	return rows[0], true
}

func wordIDByEnglish(t *testing.T, english string) string {
	t.Helper()
	var w sqlitex.Word
	if err := sqlitex.DB.Where("english = ?", english).First(&w).Error; err != nil {
		t.Fatalf("words row %q: %v", english, err)
	}
	return w.Id
}

func countUserDicts(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.UserDict{}).Where("user_id = ?", userID).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

type lookupResponse struct {
	Id                string
	English           string
	Chinese           string
	LoadCount         int
	AlreadyAcquainted int
}

func lookup(t *testing.T, raw, userID string) lookupResponse {
	t.Helper()
	c, w := translateCtx(raw, userID)
	newTestHandler().translateWord(c, raw)
	if w.Code != http.StatusOK {
		t.Fatalf("lookup %q: got %d, want 200 (body=%s)", raw, w.Code, w.Body.String())
	}
	var resp lookupResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode %q: %v (body=%s)", raw, err, w.Body.String())
	}
	return resp
}

func assertReview(t *testing.T, userID, wordID string, wantCount, wantAcquainted int) {
	t.Helper()
	row, found := userDictRow(t, userID, wordID)
	if !found {
		t.Fatalf("user_dicts row for %s missing", wordID)
	}
	if row.QueryCount != wantCount || row.AlreadyAcquainted != wantAcquainted {
		t.Fatalf("user_dicts: got query_count=%d acquainted=%d, want %d/%d",
			row.QueryCount, row.AlreadyAcquainted, wantCount, wantAcquainted)
	}
}

func assertResponse(t *testing.T, resp lookupResponse, wantID string, wantCount, wantAcquainted int) {
	t.Helper()
	if resp.Id != wantID || resp.LoadCount != wantCount || resp.AlreadyAcquainted != wantAcquainted {
		t.Fatalf("response: got id=%q LoadCount=%d AlreadyAcquainted=%d, want %q/%d/%d",
			resp.Id, resp.LoadCount, resp.AlreadyAcquainted, wantID, wantCount, wantAcquainted)
	}
}

// The lookup GET reads the review state and never writes it (ADR-059
// Decision 3): POST /api/me/word-lookups is the only thing that adds to the
// query count, so a retried GET can't move a word's review bucket.

func TestLookupAnswersWithTheCurrentReviewStateAndLeavesItAlone(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u1", id, 3, 1)

	resp := lookup(t, "serendipity", "u1")

	assertResponse(t, resp, id, 3, 1)
	assertReview(t, "u1", id, 3, 1)
}

func TestRepeatedLookupsLeaveTheQueryCountUnchanged(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u1", id, 3, 0)

	lookup(t, "serendipity", "u1")
	resp := lookup(t, "serendipity", "u1")

	assertResponse(t, resp, id, 3, 0)
	assertReview(t, "u1", id, 3, 0)
}

func TestLookupOfANeverLookedUpWordWritesNoReviewRow(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")

	resp := lookup(t, "serendipity", "u1")

	assertResponse(t, resp, id, 0, 0)
	if n := countUserDicts(t, "u1"); n != 0 {
		t.Fatalf("user_dicts rows: got %d, want 0", n)
	}
}

// The local words lookup falls back to a case-insensitive match; the review
// state is the stored word's, not what the user typed.
func TestLookupIsCaseInsensitive(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u1", id, 2, 0)

	resp := lookup(t, "Serendipity", "u1")

	assertResponse(t, resp, id, 2, 0)
}

func TestLookupReadsOnlyTheCallersReviewState(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u2", id, 7, 1)

	resp := lookup(t, "serendipity", "u1")

	assertResponse(t, resp, id, 0, 0)
	assertReview(t, "u2", id, 7, 1)
}

func TestEcdictFillCachesTheWordWithoutAReviewRow(t *testing.T) {
	setupReviewTest(t, stardictRow{Word: "quixotic", Sw: "quixotic", Phonetic: "kwɪkˈsɒtɪk", Translation: "a. 不切实际的"})

	resp := lookup(t, "quixotic", "u1")

	id := wordIDByEnglish(t, "quixotic")
	assertResponse(t, resp, id, 0, 0)
	if resp.Chinese != "a. 不切实际的" {
		t.Fatalf("chinese: got %q", resp.Chinese)
	}
	if n := countUserDicts(t, "u1"); n != 0 {
		t.Fatalf("user_dicts rows: got %d, want 0", n)
	}
}

func TestMissInBothSourcesWritesNoReviewRow(t *testing.T) {
	setupReviewTest(t)

	resp := lookup(t, "zzxqv", "u1")

	if resp.Id != "" {
		t.Fatalf("id: got %q, want empty", resp.Id)
	}
	if n := countUserDicts(t, "u1"); n != 0 {
		t.Fatalf("user_dicts rows: got %d, want 0", n)
	}
}

// Looking up an inflection ("ran") resolves via ECDICT's exchange column to
// its headword ("run"). The answer carries the headword's id and review
// state: the id the client then records the lookup against.
func TestInflectionAnswersWithTheHeadwordsIdAndReviewState(t *testing.T) {
	setupReviewTest(t, stardictRow{Word: "run", Sw: "run", Translation: "v. 跑", Exchange: "p:ran/d:run/i:running/3:runs"})
	id := seedWord(t, "run")
	seedUserDict(t, "u1", id, 5, 1)

	resp := lookup(t, "ran", "u1")

	assertResponse(t, resp, id, 5, 1)
	assertReview(t, "u1", id, 5, 1)
}
