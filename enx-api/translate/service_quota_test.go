package translate

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/dictionary/adapters"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func setupQuotaTestDB(t *testing.T) {
	t.Helper()
	prev := sqlitex.DB
	sqlitex.Init(filepath.Join(t.TempDir(), "test.db"))
	db := sqlitex.DB
	t.Cleanup(func() { raw, _ := db.DB(); _ = raw.Close(); sqlitex.DB = prev })

}

// noAI is an Entitlements for tests that don't exercise AI definitions.
type noAI struct{}

func (noAI) CanUseAI(context.Context, string) (bool, error) { return false, nil }

// newTestHandler wires the production dictionary service and review log
// over whatever sqlitex.DB and ECDICT the test has set up, with the default
// lookup ceilings.
func newTestHandler() *Handler {
	return newTestHandlerWithQuota(config.StripeQuota{
		DictionaryLookupDailyFree: 200, DictionaryLookupDailySubscribed: 20000,
	})
}

func newTestHandlerWithQuota(limits config.StripeQuota) *Handler {
	return NewHandler(
		dictionary.NewService(adapters.WordsTable{}, adapters.Ecdict{}, noAI{}),
		dictionary.NewQuotaMeter(adapters.QuotaUsage{}, entadapters.Billing{}, limits, time.Now),
		repo.ReviewLog{},
	)
}

func translateCtx(word, userID string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/translate?word="+word, nil)
	c.Set("user_id", userID)
	return c, w
}

// A word already in the local `words` cache still costs one against the
// daily quota, and the GET writes no lookup event (ADR-079 Decision 7).
func TestTranslateWordChargesOneAndAnswers429AtTheLimitWithoutEvents(t *testing.T) {
	setupQuotaTestDB(t)
	h := newTestHandlerWithQuota(config.StripeQuota{DictionaryLookupDailyFree: 1, DictionaryLookupDailySubscribed: 20000})
	gin.SetMode(gin.TestMode)

	zh := "机缘巧合"
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: uuid.NewString(), English: "serendipity", Chinese: &zh,
		CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed word: %v", err)
	}

	c1, w1 := translateCtx("serendipity", "u-local")
	h.translateWord(c1, "serendipity")
	if w1.Code != http.StatusOK {
		t.Fatalf("lookup 1: got %d, want 200 (body=%s)", w1.Code, w1.Body.String())
	}

	c2, w2 := translateCtx("serendipity", "u-local")
	h.translateWord(c2, "serendipity")
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("lookup 2: got %d, want 429 -- a local cache hit must count against the quota", w2.Code)
	}
	// The code tells the clients this 429 from the request rate limit's
	// (ADR-060 Decision 4).
	var body map[string]any
	_ = json.Unmarshal(w2.Body.Bytes(), &body)
	if body["code"] != "lookup_quota_exceeded" {
		t.Fatalf("code = %v, want lookup_quota_exceeded", body["code"])
	}

	var usage sqlitex.DictionaryQuotaUsage
	if err := sqlitex.DB.Where("user_id = ?", "u-local").First(&usage).Error; err != nil {
		t.Fatal(err)
	}
	if usage.Used != 1 || usage.Rejected != 1 {
		t.Fatalf("quota used %d rejected %d, want 1 and 1", usage.Used, usage.Rejected)
	}
	var events int64
	sqlitex.DB.Model(&sqlitex.LookupEvent{}).Count(&events)
	if events != 0 {
		t.Fatalf("%d lookup events, want none", events)
	}
}

// A sentence is answered without a lookup, so it costs nothing.
func TestTranslateSentenceIsNotCharged(t *testing.T) {
	setupQuotaTestDB(t)
	gin.SetMode(gin.TestMode)

	c, w := translateCtx("hello%20world", "u1")
	newTestHandler().translateWord(c, "hello world")

	var n int64
	sqlitex.DB.Model(&sqlitex.DictionaryQuotaUsage{}).Where("used > 0 OR rejected > 0").Count(&n)
	if w.Code != http.StatusOK || n != 0 {
		t.Fatalf("got %d with %d charged quota rows, want 200 and none", w.Code, n)
	}
}
