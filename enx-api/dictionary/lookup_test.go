package dictionary

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"enx-api/ecdict"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.Word{}, &sqlitex.Subscription{}, &sqlitex.DictionaryLookupQuota{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

// setupFakeEcdict makes ecdict.IsAvailable() report true against a real
// (but empty) on-disk sqlite file with the stardict table shape, so Lookup
// exercises its quota path instead of short-circuiting on
// ErrEcdictUnavailable. The actual query result doesn't matter for these
// tests -- only whether Lookup got past the quota check.
func setupFakeEcdict(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "ecdict.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE stardict (word TEXT, sw TEXT, phonetic TEXT, translation TEXT, exchange TEXT)`).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.Close()

	ecdict.Init(dbPath)
	t.Cleanup(func() { ecdict.Init("") })
}

func setQuotaLimit(t *testing.T, limit int64) {
	t.Helper()
	previous := viper.Get("stripe.quota.dictionary-lookup-daily")
	viper.Set("stripe.quota.dictionary-lookup-daily", limit)
	t.Cleanup(func() { viper.Set("stripe.quota.dictionary-lookup-daily", previous) })
}

func TestLookupReturnsUnavailableWhenEcdictMissing(t *testing.T) {
	setupTestDB(t)
	ecdict.Init("")
	_, err := Lookup(context.Background(), "unknownword", "test-user")
	if !errors.Is(err, ErrEcdictUnavailable) {
		t.Fatalf("expected ErrEcdictUnavailable, got %v", err)
	}
}

func TestLookupEnforcesQuotaForFreeUser(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimit(t, 2)
	userID := "u-" + t.Name()
	ctx := context.Background()

	if _, err := Lookup(ctx, "word1", userID); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	if _, err := Lookup(ctx, "word2", userID); err != nil {
		t.Fatalf("lookup 2: %v", err)
	}
	if _, err := Lookup(ctx, "word3", userID); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("lookup 3: got %v, want ErrQuotaExceeded", err)
	}
}

func TestLookupSkipsQuotaForActiveSubscriber(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimit(t, 1) // deliberately tiny, to prove the subscriber ignores it
	userID := "u-" + t.Name()
	ctx := context.Background()

	if err := sqlitex.DB.Create(&sqlitex.Subscription{
		UserId:           userID,
		StripeCustomerId: "cus_1",
		Status:           "active",
		CreatedAt:        1,
		UpdatedAt:        1,
	}).Error; err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	for i := 0; i < 5; i++ {
		if _, err := Lookup(ctx, "word", userID); err != nil {
			t.Fatalf("lookup %d: subscriber should never hit the quota, got %v", i, err)
		}
	}

	// A subscriber's lookups shouldn't even be tracked in the quota table.
	var count int64
	sqlitex.DB.Model(&sqlitex.DictionaryLookupQuota{}).Where("user_id = ?", userID).Count(&count)
	if count != 0 {
		t.Fatalf("got %d quota rows for a subscriber, want 0", count)
	}
}

func TestLookupPastDueSubscriberIsNotExempt(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimit(t, 1)
	userID := "u-" + t.Name()
	ctx := context.Background()

	if err := sqlitex.DB.Create(&sqlitex.Subscription{
		UserId:           userID,
		StripeCustomerId: "cus_2",
		Status:           "past_due",
		CreatedAt:        1,
		UpdatedAt:        1,
	}).Error; err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	if _, err := Lookup(ctx, "word1", userID); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	if _, err := Lookup(ctx, "word2", userID); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("lookup 2: got %v, want ErrQuotaExceeded (past_due is not active)", err)
	}
}
