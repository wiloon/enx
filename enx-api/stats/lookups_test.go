package stats

import (
	"context"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// seedEvent writes one lookup event at the given UTC instant.
func seedEvent(t *testing.T, userID string, at time.Time, offsetMinutes int, outcome string) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.LookupEvent{
		UserID: userID, At: at.UnixMilli(), TZOffsetMinutes: offsetMinutes, Outcome: outcome,
	}).Error; err != nil {
		t.Fatalf("seed event: %v", err)
	}
}

// seedLookups writes a day's word_lookups straight to daily_stats.
func seedLookups(t *testing.T, userID, date string, lookups int64) {
	t.Helper()
	if err := sqlitex.DB.Exec(
		`INSERT INTO daily_stats (user_id, date, word_lookups) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, date) DO UPDATE SET word_lookups = excluded.word_lookups`,
		userID, date, lookups,
	).Error; err != nil {
		t.Fatalf("seed lookups %s: %v", date, err)
	}
}

func utc(year int, month time.Month, day, hour int) time.Time {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
}

// now is 2026-09-16 12:00 UTC, a Wednesday; the week started on the 14th.

// Today's and yesterday's lookups come live from the events, so a lookup
// shows up at once; older days come from the daily rollup (ADR-059
// Decision 4).
func TestOverviewLookupsAreLiveForTodayAndYesterday(t *testing.T) {
	user := "u-" + t.Name()
	seedLookups(t, user, "2026-09-14", 5)  // older: the rollup's number
	seedLookups(t, user, "2026-09-16", 99) // a stale rollup of today: ignored
	seedEvent(t, user, utc(2026, 9, 16, 1), 480, "allowed")
	seedEvent(t, user, utc(2026, 9, 15, 20), 480, "allowed") // 04:00 on the 16th in Beijing
	seedEvent(t, user, utc(2026, 9, 16, 2), 480, "rejected") // a 429 is not a lookup the user made
	seedEvent(t, user, utc(2026, 9, 15, 3), 480, "allowed")  // yesterday

	ov, err := GetOverview(context.Background(), user, "2026-09-16", now)
	if err != nil {
		t.Fatal(err)
	}

	if ov.Today.WordLookups != 2 {
		t.Errorf("today's lookups = %d, want 2", ov.Today.WordLookups)
	}
	if ov.Week.WordLookups != 5+1+2 {
		t.Errorf("this week's lookups = %d, want 8 (5 rolled up, 1 yesterday, 2 today)", ov.Week.WordLookups)
	}
}

func TestOverviewLeavesTheOtherMetricsAlone(t *testing.T) {
	user := "u-" + t.Name()
	seedDay(t, user, "2026-09-16", 300)
	seedEvent(t, user, utc(2026, 9, 16, 1), 0, "allowed")

	ov, err := GetOverview(context.Background(), user, "2026-09-16", now)
	if err != nil {
		t.Fatal(err)
	}
	if ov.Today.WordsRead != 300 || ov.Today.WordLookups != 1 {
		t.Fatalf("today = %+v, want 300 words read and 1 lookup", ov.Today)
	}
}

func TestSeriesLookupsAreLiveForTodayAndYesterday(t *testing.T) {
	user := "u-" + t.Name()
	seedLookups(t, user, "2026-09-14", 4)
	seedLookups(t, user, "2026-09-15", 77) // stale: yesterday is read live
	seedEvent(t, user, utc(2026, 9, 15, 3), 0, "allowed")
	seedEvent(t, user, utc(2026, 9, 16, 3), 0, "allowed")
	seedEvent(t, user, utc(2026, 9, 16, 4), 0, "allowed")

	points, err := GetSeries(context.Background(), user, PeriodDay,
		utc(2026, 9, 14, 0), utc(2026, 9, 16, 0), "2026-09-16")
	if err != nil {
		t.Fatal(err)
	}

	var got []int64
	for _, p := range points {
		got = append(got, p.Totals.WordLookups)
	}
	if len(got) != 3 || got[0] != 4 || got[1] != 1 || got[2] != 2 {
		t.Fatalf("daily lookups %v, want [4 1 2]", got)
	}
}

func TestRollupOverwritesWithTheAllowedCountOfEachLocalDay(t *testing.T) {
	user := "u-" + t.Name()
	ctx := context.Background()
	seedLookups(t, user, "2026-09-10", 50) // stale
	seedDay(t, user, "2026-09-10", 1000)   // words read: not the rollup's
	seedEvent(t, user, utc(2026, 9, 10, 3), 480, "allowed")
	seedEvent(t, user, utc(2026, 9, 10, 4), 480, "allowed")
	seedEvent(t, user, utc(2026, 9, 9, 20), 480, "allowed")  // 04:00 on the 10th in Beijing
	seedEvent(t, user, utc(2026, 9, 10, 20), 480, "allowed") // 04:00 on the 11th in Beijing
	seedEvent(t, user, utc(2026, 9, 10, 5), 480, "rejected")

	for run := 1; run <= 2; run++ {
		if _, err := RollupLookupEvents(ctx, now, 90); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		if got := day(t, user, "2026-09-10"); got.WordLookups != 3 || got.WordsRead != 1000 {
			t.Fatalf("run %d: the 10th = %+v, want 3 lookups and 1000 words read", run, got)
		}
		if got := day(t, user, "2026-09-11").WordLookups; got != 1 {
			t.Fatalf("run %d: the 11th = %d lookups, want 1", run, got)
		}
	}
}

func TestRollupDeletesOnlyEventsPastTheRetention(t *testing.T) {
	user := "u-" + t.Name()
	ctx := context.Background()
	seedEvent(t, user, now.AddDate(0, 0, -40).Add(-time.Minute), 0, "allowed")
	seedEvent(t, user, now.AddDate(0, 0, -40).Add(time.Minute), 0, "allowed")
	seedEvent(t, user, now.Add(-time.Hour), 0, "allowed")

	if _, err := RollupLookupEvents(ctx, now, 40); err != nil {
		t.Fatal(err)
	}

	var left []int64
	sqlitex.DB.Model(&sqlitex.LookupEvent{}).Where("user_id = ?", user).Order("at").Pluck("at", &left)
	want := []int64{now.AddDate(0, 0, -40).Add(time.Minute).UnixMilli(), now.Add(-time.Hour).UnixMilli()}
	if len(left) != 2 || left[0] != want[0] || left[1] != want[1] {
		t.Fatalf("events left at %v, want %v", left, want)
	}
}

// A day whose events have started to be deleted must keep the count it was
// rolled up with, not be rolled up again from what is left.
func TestRollupKeepsADayWhoseEventsAreBeingDeleted(t *testing.T) {
	user := "u-" + t.Name()
	ctx := context.Background()
	boundary := now.AddDate(0, 0, -40)
	seedEvent(t, user, boundary.Add(-time.Hour), 0, "allowed")
	seedEvent(t, user, boundary.Add(time.Hour), 0, "allowed")
	seedLookups(t, user, boundary.Format(DateLayout), 2) // what earlier runs rolled up

	// The first run deletes the earlier event; the second must not roll the
	// day up again from the one left.
	for run := 1; run <= 2; run++ {
		if _, err := RollupLookupEvents(ctx, now, 40); err != nil {
			t.Fatal(err)
		}
	}

	if got := day(t, user, boundary.Format(DateLayout)).WordLookups; got != 2 {
		t.Fatalf("boundary day = %d lookups, want the 2 already rolled up", got)
	}
}
