package adapters

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/utils/sqlitex"
)

// freeUser is a Subscriptions with no subscriber.
type freeUser struct{}

func (freeUser) IsActiveSubscriber(context.Context, string) (bool, error) { return false, nil }

var quotaNoon = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

// setupQuotaUsageDB opens a file database with the production settings, so
// concurrent charges contend for the write lock as they do in production.
func setupQuotaUsageDB(t *testing.T) {
	t.Helper()
	prev := sqlitex.DB
	sqlitex.Init(filepath.Join(t.TempDir(), "quota.db"))
	db := sqlitex.DB
	t.Cleanup(func() { raw, _ := db.DB(); _ = raw.Close(); sqlitex.DB = prev })
}

func newSQLiteMeter(freeLimit int64) *dictionary.QuotaMeter {
	limits := config.StripeQuota{DictionaryLookupDailyFree: freeLimit, DictionaryLookupDailySubscribed: 20000}
	return dictionary.NewQuotaMeter(QuotaUsage{}, freeUser{}, limits, func() time.Time { return quotaNoon })
}

func usageOf(t *testing.T, userID, day string) (used, rejected int64, found bool) {
	t.Helper()
	var rows []sqlitex.DictionaryQuotaUsage
	if err := sqlitex.DB.Where("user_id = ? AND utc_day = ?", userID, day).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return 0, 0, false
	}
	return rows[0].Used, rows[0].Rejected, true
}

func TestQuotaMeterAllowsABatchThatFitsAndRejectsOneThatDoesNot(t *testing.T) {
	setupQuotaUsageDB(t)
	m := newSQLiteMeter(5)
	ctx := context.Background()

	if err := m.Charge(ctx, "u1", 3); err != nil {
		t.Fatalf("batch of 3 under a limit of 5: %v", err)
	}
	if err := m.Charge(ctx, "u1", 3); !errors.Is(err, dictionary.ErrQuotaExceeded) {
		t.Fatalf("batch of 3 with 2 left: %v, want ErrQuotaExceeded", err)
	}
	if err := m.Charge(ctx, "u1", 2); err != nil {
		t.Fatalf("batch of 2 with 2 left: %v, want allowed (the rejected batch used nothing)", err)
	}

	if used, rejected, _ := usageOf(t, "u1", "2026-11-10"); used != 5 || rejected != 3 {
		t.Fatalf("used %d rejected %d, want 5 and 3", used, rejected)
	}
}

// The first charge of the day creates the row; one larger than the limit is
// rejected whole, never stored as used.
func TestQuotaMeterRejectsAFirstChargeAboveTheLimit(t *testing.T) {
	setupQuotaUsageDB(t)
	m := newSQLiteMeter(2)

	if err := m.Charge(context.Background(), "u1", 3); !errors.Is(err, dictionary.ErrQuotaExceeded) {
		t.Fatalf("got %v, want ErrQuotaExceeded", err)
	}

	used, rejected, found := usageOf(t, "u1", "2026-11-10")
	if !found || used != 0 || rejected != 3 {
		t.Fatalf("row found=%v used %d rejected %d, want a row with 0 and 3", found, used, rejected)
	}
}

func TestQuotaMeterCountsEachUserAndDayApart(t *testing.T) {
	setupQuotaUsageDB(t)
	ctx := context.Background()
	now := quotaNoon
	limits := config.StripeQuota{DictionaryLookupDailyFree: 1, DictionaryLookupDailySubscribed: 20000}
	m := dictionary.NewQuotaMeter(QuotaUsage{}, freeUser{}, limits, func() time.Time { return now })

	if err := m.Charge(ctx, "u1", 1); err != nil {
		t.Fatal(err)
	}
	if err := m.Charge(ctx, "u2", 1); err != nil {
		t.Fatalf("another user's first charge: %v", err)
	}
	now = time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	if err := m.Charge(ctx, "u1", 1); err != nil {
		t.Fatalf("u1's first charge of the next UTC day: %v", err)
	}
	if used, _, _ := usageOf(t, "u1", "2026-11-11"); used != 1 {
		t.Fatalf("u1 on 2026-11-11 used %d, want 1", used)
	}
}

// Simultaneous batches that together cross the limit: exactly as many are
// allowed as fit, and used never passes the limit.
func TestQuotaMeterSimultaneousChargesNeverPassTheLimit(t *testing.T) {
	setupQuotaUsageDB(t)
	m := newSQLiteMeter(10)

	const batches, size = 8, 3
	var wg sync.WaitGroup
	errs := make([]error, batches)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = m.Charge(context.Background(), "u1", size)
		}(i)
	}
	wg.Wait()

	allowed := 0
	for _, err := range errs {
		switch {
		case err == nil:
			allowed++
		case !errors.Is(err, dictionary.ErrQuotaExceeded):
			t.Fatalf("unexpected error %v", err)
		}
	}
	used, rejected, _ := usageOf(t, "u1", "2026-11-10")
	if allowed != 3 || used != 9 || rejected != int64((batches-allowed)*size) {
		t.Fatalf("allowed %d, used %d, rejected %d; want 3 batches, 9 used, %d rejected", allowed, used, rejected, (batches-3)*size)
	}
}

func TestQuotaUsageDeleteOutsideRetentionKeepsTheWindow(t *testing.T) {
	setupQuotaUsageDB(t)
	for _, day := range []string{"2026-10-09", "2026-10-10", "2026-11-10"} {
		if err := sqlitex.DB.Create(&sqlitex.DictionaryQuotaUsage{UserID: "u1", UTCDay: day, Used: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}

	// 31 days back from 2026-11-10 12:00 UTC is 2026-10-10 12:00: that day is
	// partly inside the window, the day before wholly outside.
	deleted, err := QuotaUsage{}.DeleteOutsideRetention(context.Background(), quotaNoon, 31)
	if err != nil {
		t.Fatal(err)
	}

	var days []string
	sqlitex.DB.Model(&sqlitex.DictionaryQuotaUsage{}).Order("utc_day").Pluck("utc_day", &days)
	if deleted != 1 || len(days) != 2 || days[0] != "2026-10-10" || days[1] != "2026-11-10" {
		t.Fatalf("deleted %d, left %v; want 1 deleted and [2026-10-10 2026-11-10] kept", deleted, days)
	}
}
