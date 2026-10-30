package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/dictionary/adapters"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

type wordLookupResponse struct {
	QueryCount int  `json:"queryCount"`
	Known      bool `json:"known"`
}

// defaultLookupQuota is generous enough that no test reaches it by accident.
var defaultLookupQuota = config.StripeQuota{DictionaryLookupDailyFree: 200, DictionaryLookupDailySubscribed: 20000}

// sendWordLookup sends POST /api/me/word-lookups with body as userID to the
// production wiring, metered with limits, and returns the recorder.
func sendWordLookup(t *testing.T, limits config.StripeQuota, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	meter := dictionary.NewQuotaMeter(adapters.LookupEvents{}, entadapters.Billing{}, limits, time.Now)
	h := NewWordLookupHandler(dictionary.NewWordLookups(adapters.QueryCounts{}, meter))
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", userID) })
	router.POST("/api/me/word-lookups", h.Record)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/me/word-lookups", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)
	return w
}

// postWordLookup sends POST /api/me/word-lookups with body as userID and
// returns the status and the decoded body.
func postWordLookup(t *testing.T, userID, body string) (int, wordLookupResponse) {
	t.Helper()
	w := sendWordLookup(t, defaultLookupQuota, userID, body)
	var resp wordLookupResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode %s: %v", w.Body.String(), err)
		}
	}
	return w.Code, resp
}

func lookupOutcomes(t *testing.T, userID string) []string {
	t.Helper()
	var outcomes []string
	if err := sqlitex.DB.Model(&sqlitex.LookupEvent{}).Where("user_id = ?", userID).Order("rowid").Pluck("outcome", &outcomes).Error; err != nil {
		t.Fatal(err)
	}
	return outcomes
}

// seedLookupEvents fills userID's quota for today with n allowed events.
func seedLookupEvents(t *testing.T, userID string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := sqlitex.DB.Create(&sqlitex.LookupEvent{
			UserID: userID, At: time.Now().UnixMilli(), Outcome: "allowed",
		}).Error; err != nil {
			t.Fatalf("seed lookup event: %v", err)
		}
	}
}

func recordLookupOf(t *testing.T, userID, wordID string) wordLookupResponse {
	t.Helper()
	code, resp := postWordLookup(t, userID, `{"wordId":"`+wordID+`"}`)
	if code != http.StatusOK {
		t.Fatalf("POST lookup of %s: got %d, want 200", wordID, code)
	}
	return resp
}

func seedReview(t *testing.T, userID, wordID string, queryCount int, known bool) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.UserDict{
		UserId: userID, WordId: wordID, QueryCount: queryCount,
		Known: known, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed user_dict: %v", err)
	}
}

func reviewOf(t *testing.T, userID, wordID string) (queryCount int, known bool, found bool) {
	t.Helper()
	var rows []sqlitex.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return 0, false, false
	}
	return rows[0].QueryCount, rows[0].Known, true
}

func TestWordLookupFirstTimeStartsTheQueryCountAtOne(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	resp := recordLookupOf(t, "u1", id)

	if resp.QueryCount != 1 || resp.Known {
		t.Fatalf("response %+v, want queryCount 1, not known", resp)
	}
	if qc, ac, _ := reviewOf(t, "u1", id); qc != 1 || ac {
		t.Fatalf("user_dicts %d/%v, want 1/false", qc, ac)
	}
}

func TestWordLookupKeepsAccumulating(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u1", id, 3, false)

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
	seedReview(t, "u1", id, 7, true)

	resp := recordLookupOf(t, "u1", id)

	if resp.QueryCount != 8 || resp.Known {
		t.Fatalf("response %+v, want queryCount 8, not known", resp)
	}
}

func TestWordLookupOnlyTouchesTheCallersRow(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u2", id, 7, true)

	recordLookupOf(t, "u1", id)

	if qc, ac, _ := reviewOf(t, "u2", id); qc != 7 || !ac {
		t.Fatalf("another user's row %d/%v, want 7/true untouched", qc, ac)
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

// Recording a lookup the lookup GET already answered is not a lookup
// request: no quota, no lookup event (ADR-059 Decision 3). Extensions that
// never send fromCache see exactly this.
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

func TestWordLookupNotFromCacheIsNotMeteredEvenOverQuota(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedLookupEvents(t, "u1", 1)
	limits := config.StripeQuota{DictionaryLookupDailyFree: 1, DictionaryLookupDailySubscribed: 20000}

	w := sendWordLookup(t, limits, "u1", `{"wordId":"`+id+`","fromCache":false}`)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	if qc, _, _ := reviewOf(t, "u1", id); qc != 1 {
		t.Fatalf("query count %d, want 1", qc)
	}
	if got := lookupOutcomes(t, "u1"); len(got) != 1 {
		t.Fatalf("lookup events %v, want only the seeded one", got)
	}
}

// A lookup the extension answered from its local dictionary cache sent no
// lookup GET, so this POST charges the click instead (ADR-061 Decision 4).
func TestWordLookupFromCacheIsChargedAsALookup(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	code, resp := postWordLookup(t, "u1", `{"wordId":"`+id+`","fromCache":true}`)

	if code != http.StatusOK || resp.QueryCount != 1 {
		t.Fatalf("got %d %+v, want 200 with queryCount 1", code, resp)
	}
	if got := lookupOutcomes(t, "u1"); len(got) != 1 || got[0] != "allowed" {
		t.Fatalf("lookup events %v, want [allowed]", got)
	}
}

func TestWordLookupFromCacheOverQuotaIs429AndLeavesTheCount(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u1", id, 3, false)
	seedLookupEvents(t, "u1", 1)
	limits := config.StripeQuota{DictionaryLookupDailyFree: 1, DictionaryLookupDailySubscribed: 20000}

	w := sendWordLookup(t, limits, "u1", `{"wordId":"`+id+`","fromCache":true}`)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d, want 429 (body=%s)", w.Code, w.Body.String())
	}
	if qc, _, _ := reviewOf(t, "u1", id); qc != 3 {
		t.Fatalf("query count %d, want 3 unchanged", qc)
	}
	if got := lookupOutcomes(t, "u1"); len(got) != 2 || got[1] != "rejected" {
		t.Fatalf("lookup events %v, want [allowed rejected]", got)
	}
}

// The extension handles both 429s alike, so the body must be the lookup
// GET's (dictionary.RespondQuotaExceeded).
func TestWordLookupFromCacheOverQuotaAnswersTheLookupGETs429Body(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedLookupEvents(t, "u1", 1)
	limits := config.StripeQuota{DictionaryLookupDailyFree: 1, DictionaryLookupDailySubscribed: 20000}

	w := sendWordLookup(t, limits, "u1", `{"wordId":"`+id+`","fromCache":true}`)

	want := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(want)
	dictionary.RespondQuotaExceededWithSubscriptions(c, "u1", entadapters.Billing{})
	if w.Code != want.Code || w.Body.String() != want.Body.String() {
		t.Fatalf("got %d %s, want %d %s", w.Code, w.Body.String(), want.Code, want.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "lookup_quota_exceeded" {
		t.Fatalf("code = %v, want lookup_quota_exceeded", body["code"])
	}
}

// The extension answers the 404 with a fresh lookup GET, which charges the
// click; charging here too would count it twice.
func TestWordLookupFromCacheOfAnUnknownWordIs404AndNotCharged(t *testing.T) {
	setupKnownTest(t)

	code, _ := postWordLookup(t, "u1", `{"wordId":"no-such-word","fromCache":true}`)

	if code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", code)
	}
	if got := lookupOutcomes(t, "u1"); len(got) != 0 {
		t.Fatalf("lookup events %v, want none", got)
	}
	if _, _, found := reviewOf(t, "u1", "no-such-word"); found {
		t.Fatal("a user_dicts row was written for a word that does not exist")
	}
}

type quotaRecorder struct{}

func (quotaRecorder) Record(context.Context, string, string, bool) (int, bool, error) {
	return 0, false, dictionary.ErrQuotaExceeded
}

type quotaSubscriber bool

func (s quotaSubscriber) IsActiveSubscriber(context.Context, string) (bool, error) {
	return bool(s), nil
}

func TestWordLookupQuotaResponseUsesInjectedSubscription(t *testing.T) {
	for _, tc := range []struct {
		active bool
		want   string
	}{{true, "contact support"}, {false, "Upgrade"}} {
		h := NewWordLookupHandler(quotaRecorder{}).WithSubscriptions(quotaSubscriber(tc.active))
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set("user_id", "u1") })
		r.POST("/", h.Record)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"wordId":"w1","fromCache":true}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), tc.want) {
			t.Fatalf("active %v: %d %s", tc.active, w.Code, w.Body.String())
		}
	}
}
