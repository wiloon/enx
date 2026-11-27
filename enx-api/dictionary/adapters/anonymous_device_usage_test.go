package adapters

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

func deviceUsed(t *testing.T, hash, day string) int64 {
	t.Helper()
	var used int64
	if err := sqlitex.DB.Raw("SELECT COALESCE(SUM(used), 0) FROM anonymous_device_usage WHERE device_hash = ? AND utc_day = ?",
		hash, day).Scan(&used).Error; err != nil {
		t.Fatal(err)
	}
	return used
}

func TestAnonymousDeviceUsageTakesUpToTheLimitPerUTCDay(t *testing.T) {
	setupQuotaUsageDB(t)
	ctx := context.Background()
	store := AnonymousDeviceUsage{}

	for i := 0; i < 2; i++ {
		if ok, err := store.Take(ctx, "h1", quotaNoon, 2); err != nil || !ok {
			t.Fatalf("take %d: %v %v, want allowed", i+1, ok, err)
		}
	}
	if ok, err := store.Take(ctx, "h1", quotaNoon, 2); err != nil || ok {
		t.Fatalf("third take: %v %v, want refused", ok, err)
	}
	if got := deviceUsed(t, "h1", "2026-11-10"); got != 2 {
		t.Fatalf("used = %d, want 2: a refused take adds nothing", got)
	}
	if ok, err := store.Take(ctx, "h2", quotaNoon, 2); err != nil || !ok {
		t.Fatalf("another device: %v %v", ok, err)
	}
	if ok, err := store.Take(ctx, "h1", quotaNoon.Add(12*time.Hour), 2); err != nil || !ok {
		t.Fatalf("the next UTC day: %v %v", ok, err)
	}
}

func TestAnonymousDeviceUsageConcurrentTakesNeverPassTheLimit(t *testing.T) {
	setupQuotaUsageDB(t)
	store := AnonymousDeviceUsage{}
	var allowed atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := store.Take(context.Background(), "h1", quotaNoon, 5)
			if err != nil {
				t.Error(err)
			}
			if ok {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 5 || deviceUsed(t, "h1", "2026-11-10") != 5 {
		t.Fatalf("%d allowed, used %d; want 5 and 5", allowed.Load(), deviceUsed(t, "h1", "2026-11-10"))
	}
}
