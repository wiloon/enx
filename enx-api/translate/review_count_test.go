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

// Characterization tests for the per-user review bookkeeping translateWord
// does on every lookup (#22): user_dicts.QueryCount drives the review bucket
// and so the underline colour in enx-chrome. They pin today's behaviour so
// the ADR-018 deep-seam refactor can move the lookup code safely.

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
	setQuotaLimit(t, 0)
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

func TestLocalHitFirstLookupSeedsQueryCountOne(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")

	resp := lookup(t, "serendipity", "u1")

	assertReview(t, "u1", id, 1, 0)
	assertResponse(t, resp, id, 1, 0)
}

func TestLocalHitRepeatLookupIncrementsQueryCount(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u1", id, 3, 0)

	resp := lookup(t, "serendipity", "u1")

	assertReview(t, "u1", id, 4, 0)
	assertResponse(t, resp, id, 4, 0)
}

// Looking up a word the user marked as known puts it back in the review pool.
func TestLocalHitOnAcquaintedWordResetsItAndIncrements(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u1", id, 3, 1)

	resp := lookup(t, "serendipity", "u1")

	assertReview(t, "u1", id, 4, 0)
	assertResponse(t, resp, id, 4, 0)
}

// MarkWord on a never-looked-up word creates the row with query_count 0 and
// acquainted 1; the first lookup afterwards must still reset and count.
func TestLocalHitAfterMarkWithoutPriorLookup(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u1", id, 0, 1)

	resp := lookup(t, "serendipity", "u1")

	assertReview(t, "u1", id, 1, 0)
	assertResponse(t, resp, id, 1, 0)
}

// The local words lookup falls back to a case-insensitive match; the review
// row is keyed on the stored word, not on what the user typed.
func TestLocalHitIsCaseInsensitive(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")

	resp := lookup(t, "Serendipity", "u1")

	assertReview(t, "u1", id, 1, 0)
	assertResponse(t, resp, id, 1, 0)
}

func TestLookupOnlyTouchesTheCallersRow(t *testing.T) {
	setupReviewTest(t)
	id := seedWord(t, "serendipity")
	seedUserDict(t, "u2", id, 7, 1)

	lookup(t, "serendipity", "u1")

	assertReview(t, "u1", id, 1, 0)
	assertReview(t, "u2", id, 7, 1)
}

func TestEcdictFillCachesWordAndSeedsQueryCountOne(t *testing.T) {
	setupReviewTest(t, stardictRow{Word: "quixotic", Sw: "quixotic", Phonetic: "kwɪkˈsɒtɪk", Translation: "a. 不切实际的"})

	resp := lookup(t, "quixotic", "u1")

	id := wordIDByEnglish(t, "quixotic")
	assertReview(t, "u1", id, 1, 0)
	assertResponse(t, resp, id, 1, 0)
	if resp.Chinese != "a. 不切实际的" {
		t.Fatalf("chinese: got %q", resp.Chinese)
	}
}

// Once ECDICT has filled the words cache, the next lookup of the same word is
// a local hit and counts on from the seeded 1.
func TestEcdictFillThenRepeatLookupIsLocalHit(t *testing.T) {
	setupReviewTest(t, stardictRow{Word: "quixotic", Sw: "quixotic", Translation: "a. 不切实际的"})

	lookup(t, "quixotic", "u1")
	resp := lookup(t, "quixotic", "u1")

	id := wordIDByEnglish(t, "quixotic")
	assertReview(t, "u1", id, 2, 0)
	assertResponse(t, resp, id, 2, 0)
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
// its headword ("run"). When "run" is already cached and the user has been
// reviewing it, the lookup should count on like any other repeat lookup.
func TestInflectionOfCachedHeadwordKeepsReviewProgress(t *testing.T) {
	setupReviewTest(t, stardictRow{Word: "run", Sw: "run", Translation: "v. 跑", Exchange: "p:ran/d:run/i:running/3:runs"})
	id := seedWord(t, "run")
	seedUserDict(t, "u1", id, 5, 1)

	resp := lookup(t, "ran", "u1")

	assertReview(t, "u1", id, 6, 0)
	assertResponse(t, resp, id, 6, 0)
}

func TestInflectionOfCachedHeadwordSeedsNewReviewRow(t *testing.T) {
	setupReviewTest(t, stardictRow{Word: "run", Sw: "run", Translation: "v. 跑", Exchange: "p:ran/d:run/i:running/3:runs"})
	id := seedWord(t, "run")

	resp := lookup(t, "ran", "u1")

	assertReview(t, "u1", id, 1, 0)
	assertResponse(t, resp, id, 1, 0)
}
