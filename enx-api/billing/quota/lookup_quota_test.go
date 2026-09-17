package quota

import (
	"context"
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

func TestIncrementLookupReturnsRunningCount(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	for i := 1; i <= 3; i++ {
		count, err := IncrementLookup(ctx, userID, now)
		if err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
		if count != int64(i) {
			t.Fatalf("lookup %d returned count=%d, want %d", i, count, i)
		}
	}

	row := loadRow(t, userID, now)
	if row.Count != 3 {
		t.Fatalf("got count=%d, want 3", row.Count)
	}
}

// The count is what tells the caller a user went over; it must keep climbing
// past whatever limit the caller applies (ADR-029 Options C2), otherwise the
// suppressed demand is invisible.
func TestIncrementLookupKeepsCountingPastAnyLimit(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	var last int64
	for i := 0; i < 20; i++ {
		count, err := IncrementLookup(ctx, userID, now)
		if err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
		last = count
	}
	if last != 20 {
		t.Fatalf("got count=%d after 20 lookups, want 20", last)
	}
}

func TestIncrementLookupResetsPerUTCDay(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	yesterday := time.Now().UTC().AddDate(0, 0, -1)
	today := time.Now().UTC()

	if _, err := IncrementLookup(ctx, userID, yesterday); err != nil {
		t.Fatalf("yesterday's lookup: %v", err)
	}
	count, err := IncrementLookup(ctx, userID, today)
	if err != nil {
		t.Fatalf("today's lookup: %v", err)
	}
	if count != 1 {
		t.Fatalf("got count=%d on a fresh day, want 1", count)
	}
}

// Concurrent increments must neither overcount nor collide on the
// (user_id, date) key, and every caller must see a distinct running count --
// a read-then-write implementation would hand the same number to two
// goroutines.
func TestIncrementLookupConcurrent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()
	const attempts = 30

	var wg sync.WaitGroup
	var mu sync.Mutex
	var errs []error
	seen := map[int64]bool{}

	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			count, err := IncrementLookup(ctx, userID, now)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
				return
			}
			seen[count] = true
		}()
	}
	wg.Wait()

	if len(errs) != 0 {
		t.Fatalf("%d of %d concurrent lookups errored: %v", len(errs), attempts, errs)
	}
	if len(seen) != attempts {
		t.Fatalf("got %d distinct counts, want %d", len(seen), attempts)
	}
	if row := loadRow(t, userID, now); row.Count != attempts {
		t.Fatalf("stored count=%d, want %d", row.Count, attempts)
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
