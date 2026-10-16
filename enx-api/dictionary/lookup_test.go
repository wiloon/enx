package dictionary

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/stats"
)

// fakeLookupEvents is an in-memory lookup event log.
type fakeLookupEvents struct {
	events   []LookupEvent
	countErr error
	addErr   error
}

func (f *fakeLookupEvents) CountSince(_ context.Context, userID string, since time.Time) (int64, error) {
	if f.countErr != nil {
		return 0, f.countErr
	}
	var n int64
	for _, e := range f.events {
		if e.UserID == userID && !e.At.Before(since) {
			n++
		}
	}
	return n, nil
}

func (f *fakeLookupEvents) Add(_ context.Context, e LookupEvent) error {
	if f.addErr != nil {
		return f.addErr
	}
	f.events = append(f.events, e)
	return nil
}

func (f *fakeLookupEvents) outcomes() []LookupOutcome {
	var out []LookupOutcome
	for _, e := range f.events {
		out = append(out, e.Outcome)
	}
	return out
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

func newTestMeter(events *fakeLookupEvents, subs fakeSubscriptions, limits config.StripeQuota, now *time.Time) *QuotaMeter {
	return NewQuotaMeter(events, subs, limits, func() time.Time { return *now })
}

func chargeN(t *testing.T, m *QuotaMeter, userID string, n int) []error {
	t.Helper()
	var errs []error
	for i := 0; i < n; i++ {
		errs = append(errs, m.Charge(context.Background(), userID))
	}
	return errs
}

func TestQuotaRejectsTheLookupPastTheLimitAndRecordsIt(t *testing.T) {
	events := &fakeLookupEvents{}
	now := noon
	m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(2, 20000), &now)

	errs := chargeN(t, m, "u1", 3)

	if errs[0] != nil || errs[1] != nil {
		t.Fatalf("first two lookups: %v, want allowed", errs[:2])
	}
	if !errors.Is(errs[2], ErrQuotaExceeded) {
		t.Fatalf("third lookup: %v, want ErrQuotaExceeded", errs[2])
	}
	want := []LookupOutcome{OutcomeAllowed, OutcomeAllowed, OutcomeRejected}
	if got := events.outcomes(); len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("events %v, want %v", got, want)
	}
}

// The quota counts requests, rejected ones included (ADR-029 C2): once over,
// a user stays over for the rest of the UTC day.
func TestQuotaCountsRejectedLookupsTowardTheLimit(t *testing.T) {
	events := &fakeLookupEvents{}
	now := noon
	m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(2, 20000), &now)

	errs := chargeN(t, m, "u1", 5)

	for i, err := range errs[2:] {
		if !errors.Is(err, ErrQuotaExceeded) {
			t.Fatalf("lookup %d: %v, want ErrQuotaExceeded", i+3, err)
		}
	}
	if len(events.events) != 5 {
		t.Fatalf("%d events, want 5 (every request is recorded)", len(events.events))
	}
}

func TestQuotaResetsAtUTCMidnight(t *testing.T) {
	events := &fakeLookupEvents{}
	now := time.Date(2026, 10, 15, 23, 59, 0, 0, time.UTC)
	m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(1, 20000), &now)

	if err := m.Charge(context.Background(), "u1"); err != nil {
		t.Fatalf("lookup before midnight: %v", err)
	}
	now = time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	if err := m.Charge(context.Background(), "u1"); err != nil {
		t.Fatalf("first lookup of the new UTC day: %v, want allowed", err)
	}
}

// The local day (here +08:00, already the 16th) does not move the quota day.
func TestQuotaDayIsUTCWhateverTheUsersTimeZone(t *testing.T) {
	events := &fakeLookupEvents{}
	now := time.Date(2026, 10, 15, 20, 0, 0, 0, time.UTC) // 04:00 on the 16th in Beijing
	m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(1, 20000), &now)
	ctx := stats.WithOffset(context.Background(), 480)

	if err := m.Charge(ctx, "u1"); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	if err := m.Charge(ctx, "u1"); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("lookup 2 on the same UTC day: %v, want ErrQuotaExceeded", err)
	}
}

func TestQuotaRecordsTheTimeAndTheUsersOffset(t *testing.T) {
	events := &fakeLookupEvents{}
	now := noon
	m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(200, 20000), &now)

	_ = m.Charge(stats.WithOffset(context.Background(), 480), "u1")
	_ = m.Charge(context.Background(), "u1")

	if len(events.events) != 2 {
		t.Fatalf("%d events, want 2", len(events.events))
	}
	if e := events.events[0]; e.UserID != "u1" || !e.At.Equal(noon) || e.TZOffsetMinutes != 480 {
		t.Fatalf("event %+v, want u1 at noon with offset 480", e)
	}
	if e := events.events[1]; e.TZOffsetMinutes != 0 {
		t.Fatalf("event without a time zone header has offset %d, want 0", e.TZOffsetMinutes)
	}
}

func TestQuotaGivesSubscribersTheirOwnCeiling(t *testing.T) {
	events := &fakeLookupEvents{}
	now := noon
	subs := fakeSubscriptions{active: map[string]bool{"paid": true}}
	m := newTestMeter(events, subs, quotaLimits(1, 3), &now)

	errs := chargeN(t, m, "paid", 4)

	if errs[1] != nil || errs[2] != nil {
		t.Fatalf("subscriber lookups 2-3: %v, want allowed past the free ceiling", errs[1:3])
	}
	if !errors.Is(errs[3], ErrQuotaExceeded) {
		t.Fatalf("subscriber lookup 4: %v, want ErrQuotaExceeded at the subscribed ceiling", errs[3])
	}
}

// #18: an unreadable subscription must not demote a paying user to the free
// tier, so it resolves to the subscribed ceiling.
func TestQuotaTreatsAFailedSubscriptionCheckAsSubscribed(t *testing.T) {
	events := &fakeLookupEvents{}
	now := noon
	subs := fakeSubscriptions{err: errors.New("db locked")}
	m := newTestMeter(events, subs, quotaLimits(1, 20000), &now)

	for i, err := range chargeN(t, m, "u1", 3) {
		if err != nil {
			t.Fatalf("lookup %d: %v, want allowed under the subscribed ceiling", i+1, err)
		}
	}
}

// #17/#18, ADR-029 E2: a store failure never costs a user their definition.
func TestQuotaFailsOpenWhenTheEventStoreFails(t *testing.T) {
	now := noon
	for name, events := range map[string]*fakeLookupEvents{
		"count fails":  {countErr: errors.New("db locked")},
		"insert fails": {addErr: errors.New("db locked")},
	} {
		t.Run(name, func(t *testing.T) {
			m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(1, 20000), &now)
			for i, err := range chargeN(t, m, "u1", 3) {
				if err != nil {
					t.Fatalf("lookup %d: %v, want allowed", i+1, err)
				}
			}
		})
	}
}

func TestQuotaCountsEachUserApart(t *testing.T) {
	events := &fakeLookupEvents{}
	now := noon
	m := newTestMeter(events, fakeSubscriptions{}, quotaLimits(1, 20000), &now)

	if err := m.Charge(context.Background(), "u1"); err != nil {
		t.Fatal(err)
	}
	if err := m.Charge(context.Background(), "u2"); err != nil {
		t.Fatalf("another user's first lookup: %v, want allowed", err)
	}
}
