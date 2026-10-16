package userstats

import (
	"context"
	"errors"
	"testing"
	"time"
)

// fakeStore keeps users and lookup events in memory and answers the Store
// queries over them, so the service's windows are what the tests check.
type fakeStore struct {
	signups []time.Time // created_at of users with a Clerk id
	events  []event
	days    map[string]ActiveDay
	saved   []string // dates passed to SaveActiveDay, in order
}

type event struct {
	user string
	at   time.Time
}

func newFakeStore() *fakeStore { return &fakeStore{days: map[string]ActiveDay{}} }

func (f *fakeStore) signup(at time.Time)              { f.signups = append(f.signups, at) }
func (f *fakeStore) lookup(user string, at time.Time) { f.events = append(f.events, event{user, at}) }

func (f *fakeStore) UsersTotal(_ context.Context, before time.Time) (int64, error) {
	var n int64
	for _, s := range f.signups {
		if s.Before(before) {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) NewUsers(_ context.Context, from, to time.Time) (int64, error) {
	var n int64
	for _, s := range f.signups {
		if !s.Before(from) && s.Before(to) {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) ActiveUsers(_ context.Context, from, to time.Time) (int64, error) {
	seen := map[string]bool{}
	for _, e := range f.events {
		if !e.at.Before(from) && e.at.Before(to) {
			seen[e.user] = true
		}
	}
	return int64(len(seen)), nil
}

func (f *fakeStore) SignupsPerDay(_ context.Context, from, to time.Time) (map[string]int64, error) {
	out := map[string]int64{}
	for _, s := range f.signups {
		if !s.Before(from) && s.Before(to) {
			out[s.UTC().Format(DateLayout)]++
		}
	}
	return out, nil
}

func (f *fakeStore) FirstSignup(context.Context) (time.Time, bool, error) {
	return earliest(f.signups)
}

func (f *fakeStore) FirstEvent(context.Context) (time.Time, bool, error) {
	ats := make([]time.Time, 0, len(f.events))
	for _, e := range f.events {
		ats = append(ats, e.at)
	}
	return earliest(ats)
}

func (f *fakeStore) ActiveDays(_ context.Context, from, to string) ([]ActiveDay, error) {
	var out []ActiveDay
	for d, row := range f.days {
		if d >= from && d <= to {
			out = append(out, row)
		}
	}
	return out, nil
}

func (f *fakeStore) SaveActiveDay(_ context.Context, d ActiveDay) error {
	f.days[d.Date] = d
	f.saved = append(f.saved, d.Date)
	return nil
}

func earliest(ts []time.Time) (time.Time, bool, error) {
	if len(ts) == 0 {
		return time.Time{}, false, nil
	}
	first := ts[0]
	for _, t := range ts[1:] {
		if t.Before(first) {
			first = t
		}
	}
	return first, true, nil
}

func at(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.UTC)
}

// now is 2026-10-16 01:30 UTC.
var now = at(2026, 10, 16, 1, 30)

func clock() time.Time { return now }

// DAU / WAU / MAU are the last 1 / 7 / 30 UTC days, today included
// (ADR-058 Decision 1).
func TestCurrentCountsUsersInTheLastOneSevenAndThirtyUTCDays(t *testing.T) {
	store := newFakeStore()
	store.lookup("today", at(2026, 10, 16, 0, 0))
	store.lookup("today", at(2026, 10, 16, 1, 0)) // twice: still one user
	store.lookup("yesterday", at(2026, 10, 15, 23, 59))
	store.lookup("week-start", at(2026, 10, 10, 0, 0))
	store.lookup("before-week", at(2026, 10, 9, 23, 59))
	store.lookup("month-start", at(2026, 9, 17, 0, 0))
	store.lookup("before-month", at(2026, 9, 16, 23, 59))

	store.signup(at(2026, 10, 16, 0, 5))
	store.signup(at(2026, 10, 12, 8, 0))
	store.signup(at(2026, 9, 20, 8, 0))
	store.signup(at(2026, 1, 1, 8, 0))

	got, err := NewService(store, clock).Current(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	want := Snapshot{
		UsersTotal: 4,
		Active:     Counts{Day: 1, Week: 3, Month: 5},
		New:        Counts{Day: 1, Week: 2, Month: 3},
	}
	if got != want {
		t.Fatalf("Current() = %+v, want %+v", got, want)
	}
}

func mustRollup(t *testing.T, svc *Service, retentionDays int) {
	t.Helper()
	if _, err := svc.Rollup(context.Background(), retentionDays); err != nil {
		t.Fatal(err)
	}
}

// Every finished UTC day from the first event on is rolled up; today, not
// over yet, is not (ADR-059 Decision 4).
func TestRollupWritesEachFinishedDaySinceTheFirstEvent(t *testing.T) {
	store := newFakeStore()
	store.lookup("u1", at(2026, 10, 13, 9, 0))
	store.lookup("u2", at(2026, 10, 14, 9, 0))
	store.lookup("u1", at(2026, 10, 15, 9, 0))
	store.lookup("u3", at(2026, 10, 16, 0, 30))

	mustRollup(t, NewService(store, clock), 90)

	want := map[string]ActiveDay{
		"2026-10-13": {Date: "2026-10-13", DAU: 1, WAU: 1, MAU: 1},
		"2026-10-14": {Date: "2026-10-14", DAU: 1, WAU: 2, MAU: 2},
		"2026-10-15": {Date: "2026-10-15", DAU: 1, WAU: 2, MAU: 2},
	}
	if len(store.days) != len(want) {
		t.Fatalf("rolled up %v, want exactly %v", store.saved, []string{"2026-10-13", "2026-10-14", "2026-10-15"})
	}
	for date, w := range want {
		if store.days[date] != w {
			t.Errorf("%s = %+v, want %+v", date, store.days[date], w)
		}
	}
}

// A day already rolled up is left alone: once its oldest events expire,
// recomputing it would make WAU and MAU too small.
func TestRollupLeavesDaysAlreadyRolledUp(t *testing.T) {
	store := newFakeStore()
	store.lookup("u1", at(2026, 10, 14, 9, 0))
	store.lookup("u2", at(2026, 10, 15, 9, 0))
	svc := NewService(store, clock)
	mustRollup(t, svc, 90)

	earlier := ActiveDay{Date: "2026-10-14", DAU: 7, WAU: 8, MAU: 9}
	store.days[earlier.Date] = earlier
	store.saved = nil
	mustRollup(t, svc, 90)

	if len(store.saved) != 0 {
		t.Errorf("the rerun wrote %v, want nothing", store.saved)
	}
	if store.days[earlier.Date] != earlier {
		t.Errorf("2026-10-14 = %+v, want it kept as %+v", store.days[earlier.Date], earlier)
	}
}

// A day whose events have started to expire is not rolled up from what is
// left of them.
func TestRollupStartsAtTheFirstDayFullyInsideRetention(t *testing.T) {
	store := newFakeStore()
	store.lookup("u1", at(2026, 9, 14, 9, 0))
	store.lookup("u1", at(2026, 9, 15, 9, 0)) // the cutoff is 2026-09-15 01:30

	mustRollup(t, NewService(store, clock), 31)

	if len(store.saved) == 0 || store.saved[0] != "2026-09-16" {
		t.Fatalf("first day rolled up = %v, want 2026-09-16", store.saved)
	}
}

// Past days read the rollup, today is computed live, and a day without a
// rollup row (before the first event) reports zero active users.
func TestDailyReadsPastDaysFromTheRollupAndTodayLive(t *testing.T) {
	store := newFakeStore()
	store.signup(at(2026, 10, 1, 8, 0))
	store.signup(at(2026, 10, 14, 8, 0))
	store.signup(at(2026, 10, 14, 23, 0))
	store.signup(at(2026, 10, 16, 1, 0))
	store.days["2026-10-15"] = ActiveDay{Date: "2026-10-15", DAU: 4, WAU: 5, MAU: 6}
	store.lookup("u1", at(2026, 10, 15, 9, 0))
	store.lookup("u1", at(2026, 10, 16, 0, 10))
	store.lookup("u2", at(2026, 10, 16, 1, 0))

	got, err := NewService(store, clock).Daily(context.Background(), "2026-10-14", "2026-10-16")
	if err != nil {
		t.Fatal(err)
	}

	want := []Day{
		{Date: "2026-10-14", UsersTotal: 3, NewUsers: 2},
		{Date: "2026-10-15", UsersTotal: 3, NewUsers: 0, DAU: 4, WAU: 5, MAU: 6},
		{Date: "2026-10-16", UsersTotal: 4, NewUsers: 1, DAU: 2, WAU: 2, MAU: 2},
	}
	assertDays(t, got, want)
}

// For a finished day the endpoint (rollup) shows what the gauges showed at
// the end of that day (live).
func TestDailyAgreesWithTheGaugesForTheSameDay(t *testing.T) {
	store := newFakeStore()
	store.signup(at(2026, 9, 1, 8, 0))
	store.signup(at(2026, 10, 15, 8, 0))
	store.lookup("u1", at(2026, 9, 20, 9, 0))
	store.lookup("u2", at(2026, 10, 12, 9, 0))
	store.lookup("u3", at(2026, 10, 15, 9, 0))
	endOfDay := at(2026, 10, 15, 23, 59)

	gauges, err := NewService(store, func() time.Time { return endOfDay }).Current(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	nextDay := NewService(store, clock)
	mustRollup(t, nextDay, 90)
	days, err := nextDay.Daily(context.Background(), "2026-10-15", "2026-10-15")
	if err != nil {
		t.Fatal(err)
	}

	want := []Day{{
		Date: "2026-10-15", UsersTotal: gauges.UsersTotal, NewUsers: gauges.New.Day,
		DAU: gauges.Active.Day, WAU: gauges.Active.Week, MAU: gauges.Active.Month,
	}}
	assertDays(t, days, want)
	if gauges.Active != (Counts{Day: 1, Week: 2, Month: 3}) {
		t.Errorf("gauges = %+v, want 1/2/3 active", gauges.Active)
	}
}

func TestDailyDefaultsToFirstSignupDayThroughToday(t *testing.T) {
	store := newFakeStore()
	store.signup(at(2026, 10, 14, 23, 0))

	got, err := NewService(store, clock).Daily(context.Background(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Date != "2026-10-14" || got[2].Date != "2026-10-16" {
		t.Fatalf("days = %+v, want 2026-10-14 through 2026-10-16", got)
	}
}

func TestDailyStopsAtToday(t *testing.T) {
	got, err := NewService(newFakeStore(), clock).Daily(context.Background(), "2026-10-15", "2026-10-20")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[1].Date != "2026-10-16" {
		t.Fatalf("days = %+v, want 2026-10-15 and 2026-10-16", got)
	}
}

func TestDailyRejectsBadRanges(t *testing.T) {
	for _, tc := range []struct{ name, from, to string }{
		{"malformed from", "2026-10", "2026-10-16"},
		{"malformed to", "2026-10-01", "16/10/2026"},
		{"from after to", "2026-10-16", "2026-10-15"},
		{"over 1000 days", "2024-01-19", "2026-10-15"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewService(newFakeStore(), clock).Daily(context.Background(), tc.from, tc.to)
			if !errors.Is(err, ErrBadRange) {
				t.Fatalf("err = %v, want ErrBadRange", err)
			}
		})
	}
}

func TestDailyAcceptsExactly1000Days(t *testing.T) {
	got, err := NewService(newFakeStore(), clock).Daily(context.Background(), "2024-01-20", "2026-10-15")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1000 {
		t.Fatalf("got %d days, want 1000", len(got))
	}
}

func assertDays(t *testing.T, got, want []Day) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("days = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("day %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestRollupWithoutEventsWritesNothing(t *testing.T) {
	store := newFakeStore()
	mustRollup(t, NewService(store, clock), 90)
	if len(store.saved) != 0 {
		t.Fatalf("rolled up %v, want nothing", store.saved)
	}
}
