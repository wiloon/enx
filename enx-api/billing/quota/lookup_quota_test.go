package quota

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"enx-api/utils"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-lookup-quota-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	os.Exit(m.Run())
}

func TestCheckAndIncrementLookupUnderLimit(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	for i := 0; i < 3; i++ {
		if err := CheckAndIncrementLookup(ctx, userID, 5, now); err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
	}

	row := loadRow(t, userID, now)
	if row.Count != 3 {
		t.Fatalf("got count=%d, want 3", row.Count)
	}
}

func TestCheckAndIncrementLookupExceedsLimit(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	for i := 0; i < 2; i++ {
		if err := CheckAndIncrementLookup(ctx, userID, 2, now); err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
	}

	if err := CheckAndIncrementLookup(ctx, userID, 2, now); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("got %v, want ErrQuotaExceeded", err)
	}

	// The rejected attempt must not have incremented the counter.
	row := loadRow(t, userID, now)
	if row.Count != 2 {
		t.Fatalf("got count=%d, want 2 (rejected attempt shouldn't count)", row.Count)
	}
}

func TestCheckAndIncrementLookupZeroLimitIsUnlimited(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	for i := 0; i < 50; i++ {
		if err := CheckAndIncrementLookup(ctx, userID, 0, now); err != nil {
			t.Fatalf("lookup %d with limit=0: %v", i, err)
		}
	}
	// limit<=0 means "don't even track it" -- no row should be created.
	var count int64
	sqlitex.DB.Model(&sqlitex.DictionaryLookupQuota{}).Where("user_id = ?", userID).Count(&count)
	if count != 0 {
		t.Fatalf("got %d quota rows for an unlimited (limit=0) user, want 0", count)
	}
}

func TestCheckAndIncrementLookupResetsPerUTCDay(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	yesterday := time.Now().UTC().AddDate(0, 0, -1)
	today := time.Now().UTC()

	if err := CheckAndIncrementLookup(ctx, userID, 1, yesterday); err != nil {
		t.Fatalf("yesterday's lookup: %v", err)
	}
	// Yesterday's single-use limit is exhausted...
	if err := CheckAndIncrementLookup(ctx, userID, 1, yesterday); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("got %v, want ErrQuotaExceeded for yesterday's second lookup", err)
	}
	// ...but today is a fresh day with its own counter.
	if err := CheckAndIncrementLookup(ctx, userID, 1, today); err != nil {
		t.Fatalf("today's lookup should succeed on a fresh counter: %v", err)
	}
}

// TestCheckAndIncrementLookupConcurrencyNoOverspend mirrors
// billing/credit's concurrency test: many goroutines racing to increment
// the same user's daily counter must never push the stored count past
// limit.
func TestCheckAndIncrementLookupConcurrencyNoOverspend(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()
	const limit = int64(15)
	const attempts = 40

	var wg sync.WaitGroup
	var mu sync.Mutex
	var succeeded, exceeded, otherErrs int64

	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := CheckAndIncrementLookup(ctx, userID, limit, now)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, ErrQuotaExceeded):
				exceeded++
			default:
				otherErrs++
				t.Logf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()

	if otherErrs != 0 {
		t.Fatalf("%d calls failed with an unexpected error", otherErrs)
	}
	if succeeded != limit {
		t.Fatalf("succeeded=%d, want exactly %d", succeeded, limit)
	}
	if succeeded+exceeded != attempts {
		t.Fatalf("succeeded+exceeded=%d, want %d", succeeded+exceeded, attempts)
	}

	row := loadRow(t, userID, now)
	if row.Count != limit {
		t.Fatalf("stored count=%d, want exactly %d (no overcount)", row.Count, limit)
	}
}

func loadRow(t *testing.T, userID string, at time.Time) sqlitex.DictionaryLookupQuota {
	t.Helper()
	var row sqlitex.DictionaryLookupQuota
	date := at.UTC().Format("2006-01-02")
	if err := sqlitex.DB.Where("user_id = ? AND date = ?", userID, date).First(&row).Error; err != nil {
		t.Fatalf("load dictionary_lookup_quota row: %v", err)
	}
	return row
}
