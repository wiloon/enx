package dictionary

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/stats"
)

// quotaCharge is one QuotaStore.Charge call.
type quotaCharge struct {
	userID string
	day    time.Time
	n      int64
	limit  int64
}

// fakeQuotaStore is an in-memory daily quota counter.
type fakeQuotaStore struct {
	used    map[string]int64 // userID -> used today
	charges []quotaCharge
	err     error
}

func newFakeQuotaStore() *fakeQuotaStore {
	return &fakeQuotaStore{used: map[string]int64{}}
}

func (f *fakeQuotaStore) Charge(_ context.Context, userID string, day time.Time, n, limit int64) (bool, error) {
	f.charges = append(f.charges, quotaCharge{userID, day, n, limit})
	if f.err != nil {
		return false, f.err
	}
	if f.used[userID]+n > limit {
		return false, nil
	}
	f.used[userID] += n
	return true, nil
}

// fakeSubscriptions says which users have an active subscription.
type fakeSubscriptions struct {
	active map[string]bool
	err    error
}

func (f fakeSubscriptions) IsActiveSubscriber(_ context.Context, userID string) (bool, error) {
	return f.active[userID], f.err
}

func quotaLimits(free, subscribed int64) config.StripeQuota {
	return config.StripeQuota{DictionaryLookupDailyFree: free, DictionaryLookupDailySubscribed: subscribed}
}

var noon = time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

func newTestMeter(store *fakeQuotaStore, subs fakeSubscriptions, limits config.StripeQuota, now *time.Time) *QuotaMeter {
	return NewQuotaMeter(store, subs, limits, func() time.Time { return *now })
}

func TestQuotaMeterChargesNOnTheUsersUTCDay(t *testing.T) {
	store := newFakeQuotaStore()
	now := time.Date(2026, 10, 15, 20, 0, 0, 0, time.UTC) // 04:00 on the 16th in Beijing
	m := newTestMeter(store, fakeSubscriptions{}, quotaLimits(200, 20000), &now)

	if err := m.Charge(stats.WithOffset(context.Background(), 480), "u1", 7); err != nil {
		t.Fatal(err)
	}

	want := quotaCharge{"u1", time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC), 7, 200}
	if len(store.charges) != 1 || store.charges[0] != want {
		t.Fatalf("charges %+v, want [%+v]", store.charges, want)
	}
}

func TestQuotaMeterReturnsErrQuotaExceededWhenTheStoreRejects(t *testing.T) {
	store := newFakeQuotaStore()
	now := noon
	m := newTestMeter(store, fakeSubscriptions{}, quotaLimits(2, 20000), &now)

	if err := m.Charge(context.Background(), "u1", 3); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("got %v, want ErrQuotaExceeded", err)
	}
}

func TestQuotaMeterPicksTheLimitByTier(t *testing.T) {
	for _, tc := range []struct {
		name string
		subs fakeSubscriptions
		want int64
	}{
		{"free", fakeSubscriptions{}, 1},
		{"subscribed", fakeSubscriptions{active: map[string]bool{"u1": true}}, 3},
		// #18: an unreadable subscription must not demote a paying user.
		{"subscription check fails", fakeSubscriptions{err: errors.New("db locked")}, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeQuotaStore()
			now := noon
			m := newTestMeter(store, tc.subs, quotaLimits(1, 3), &now)

			_ = m.Charge(context.Background(), "u1", 1)

			if len(store.charges) != 1 || store.charges[0].limit != tc.want {
				t.Fatalf("charges %+v, want one with limit %d", store.charges, tc.want)
			}
		})
	}
}

// #17/#18, ADR-029 E2: a counter that can't be written never costs a user
// their definition.
func TestQuotaMeterFailsOpenWhenTheStoreFails(t *testing.T) {
	store := newFakeQuotaStore()
	store.err = errors.New("db locked")
	now := noon
	m := newTestMeter(store, fakeSubscriptions{}, quotaLimits(1, 20000), &now)

	if err := m.Charge(context.Background(), "u1", 5); err != nil {
		t.Fatalf("got %v, want allowed", err)
	}
}
