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

func setQuotaLimits(t *testing.T, free, subscribed int64) {
	t.Helper()
	for key, value := range map[string]int64{
		"stripe.quota.dictionary-lookup-daily-free":       free,
		"stripe.quota.dictionary-lookup-daily-subscribed": subscribed,
	} {
		previous := viper.Get(key)
		viper.Set(key, value)
		t.Cleanup(func() { viper.Set(key, previous) })
	}
}

func quotaRowCount(t *testing.T, userID string) int64 {
	t.Helper()
	var count int64
	sqlitex.DB.Model(&sqlitex.DictionaryLookupQuota{}).
		Where("user_id = ?", userID).
		Select("COALESCE(SUM(count), 0)").
		Scan(&count)
	return count
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
	setQuotaLimits(t, 2, 0)
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

// The whole point of ADR-029: with no limit configured, lookups must still
// be counted -- otherwise "launch with it off, set a number from real usage"
// can never produce any usage to look at.
func TestLookupCountsWithNoLimitConfigured(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 0, 0)
	userID := "u-" + t.Name()
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if _, err := Lookup(ctx, "word", userID); err != nil {
			t.Fatalf("lookup %d: an unset limit must not block, got %v", i, err)
		}
	}

	if got := quotaRowCount(t, userID); got != 5 {
		t.Fatalf("counted %d lookups, want 5", got)
	}
}

// Rejected requests keep counting, so the overflow shows how much demand the
// limit is suppressing (ADR-029 Options C2).
func TestLookupKeepsCountingPastTheLimit(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 1, 0)
	userID := "u-" + t.Name()
	ctx := context.Background()

	if _, err := Lookup(ctx, "word", userID); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	for i := 2; i <= 4; i++ {
		if _, err := Lookup(ctx, "word", userID); !errors.Is(err, ErrQuotaExceeded) {
			t.Fatalf("lookup %d: got %v, want ErrQuotaExceeded", i, err)
		}
	}

	if got := quotaRowCount(t, userID); got != 4 {
		t.Fatalf("counted %d lookups, want 4 (rejected requests count too)", got)
	}
}

func TestLookupAppliesTheSubscribedTier(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 1, 100) // free tier deliberately tiny
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
			t.Fatalf("lookup %d: subscriber is under their own tier, got %v", i, err)
		}
	}

	// Subscribers are counted now too -- that's what makes per-user usage
	// data exist for everyone (ADR-029 Decision 1).
	if got := quotaRowCount(t, userID); got != 5 {
		t.Fatalf("counted %d lookups for a subscriber, want 5", got)
	}
}

// A failing subscription lookup must not silently demote a paying user to
// the free tier and 429 them (#18). Fail open to the highest tier -- but
// keep counting (ADR-029 Options G2).
func TestLookupTreatsSubscriberCheckFailureAsSubscriber(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 1, 100)
	userID := "u-" + t.Name()
	ctx := context.Background()

	if err := sqlitex.DB.Migrator().DropTable(&sqlitex.Subscription{}); err != nil {
		t.Fatalf("drop subscriptions table: %v", err)
	}

	for i := 0; i < 5; i++ {
		if _, err := Lookup(ctx, "word", userID); err != nil {
			t.Fatalf("lookup %d: subscriber-check failure should fail open, got %v", i, err)
		}
	}

	if got := quotaRowCount(t, userID); got != 5 {
		t.Fatalf("counted %d lookups, want 5 (fail-open still counts)", got)
	}
}

// A failing quota store must not block a dictionary lookup (#17, ADR-018 E2).
// Fail open: allow the lookup.
func TestLookupFailsOpenWhenQuotaStoreUnavailable(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 1, 0)
	userID := "u-" + t.Name()
	ctx := context.Background()

	if err := sqlitex.DB.Migrator().DropTable(&sqlitex.DictionaryLookupQuota{}); err != nil {
		t.Fatalf("drop quota table: %v", err)
	}

	for i := 0; i < 3; i++ {
		if _, err := Lookup(ctx, "word", userID); err != nil {
			t.Fatalf("lookup %d: quota-store failure should fail open, got %v", i, err)
		}
	}
}

func TestLookupPastDueSubscriberIsNotExempt(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 1, 0)
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

// The pre-ADR-029 key keeps working as the free tier for one release.
func TestLookupFallsBackToTheSupersededQuotaKey(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 0, 0)
	previous := viper.Get("stripe.quota.dictionary-lookup-daily")
	viper.Set("stripe.quota.dictionary-lookup-daily", 1)
	t.Cleanup(func() { viper.Set("stripe.quota.dictionary-lookup-daily", previous) })

	userID := "u-" + t.Name()
	ctx := context.Background()

	if _, err := Lookup(ctx, "word1", userID); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	if _, err := Lookup(ctx, "word2", userID); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("lookup 2: got %v, want ErrQuotaExceeded from the superseded key", err)
	}
}
