package translate

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/spf13/viper"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupQuotaTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&sqlitex.Word{}, &sqlitex.UserDict{},
		&sqlitex.Subscription{}, &sqlitex.DictionaryLookupQuota{},
	); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func setQuotaLimit(t *testing.T, limit int64) {
	t.Helper()
	prev := viper.Get("stripe.quota.dictionary-lookup-daily")
	viper.Set("stripe.quota.dictionary-lookup-daily", limit)
	t.Cleanup(func() { viper.Set("stripe.quota.dictionary-lookup-daily", prev) })
}

func translateCtx(word, userID string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/translate?word="+word, nil)
	c.Set("user_id", userID)
	return c, w
}

// A word already in the local `words` cache still counts against the free
// daily quota (ADR-018 B2). Today the local-hit path bypasses the meter.
func TestTranslateWordMetersLocalCacheHit(t *testing.T) {
	setupQuotaTestDB(t)
	setQuotaLimit(t, 1)
	gin.SetMode(gin.TestMode)

	zh := "机缘巧合"
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: uuid.NewString(), English: "serendipity", Chinese: &zh,
		CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed word: %v", err)
	}

	c1, w1 := translateCtx("serendipity", "u-local")
	translateWord(c1, "serendipity")
	if w1.Code != http.StatusOK {
		t.Fatalf("lookup 1: got %d, want 200 (body=%s)", w1.Code, w1.Body.String())
	}

	c2, w2 := translateCtx("serendipity", "u-local")
	translateWord(c2, "serendipity")
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("lookup 2: got %d, want 429 -- a local cache hit must count against the quota", w2.Code)
	}
}
