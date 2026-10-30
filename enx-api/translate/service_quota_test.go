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
	meter := dictionary.NewQuotaMeter(adapters.LookupEvents{}, entadapters.Billing{}, limits, time.Now)
	return NewHandler(
		dictionary.NewService(adapters.WordsTable{}, adapters.Ecdict{}, meter, noAI{}),
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

// A word already in the local `words` cache still counts against the free
// daily quota (ADR-018 B2), and the rejected request is recorded as a
// lookup event too (ADR-059 Decision 1).
func TestTranslateWordAtTheLimitAnswers429AndRecordsARejectedEvent(t *testing.T) {
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

	var outcomes []string
	sqlitex.DB.Model(&sqlitex.LookupEvent{}).Where("user_id = ?", "u-local").Order("rowid").Pluck("outcome", &outcomes)
	if len(outcomes) != 2 || outcomes[0] != "allowed" || outcomes[1] != "rejected" {
		t.Fatalf("lookup events %v, want [allowed rejected]", outcomes)
	}
}
