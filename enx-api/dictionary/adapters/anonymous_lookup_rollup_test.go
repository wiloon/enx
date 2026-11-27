package adapters

import (
	"context"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

func seedDeviceUsage(t *testing.T, rows ...sqlitex.AnonymousDeviceUsage) {
	t.Helper()
	for _, r := range rows {
		if err := sqlitex.DB.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func anonymousDays(t *testing.T) []sqlitex.AnonymousLookupsDay {
	t.Helper()
	var days []sqlitex.AnonymousLookupsDay
	if err := sqlitex.DB.Order("utc_day").Find(&days).Error; err != nil {
		t.Fatal(err)
	}
	return days
}

func deviceUsageDays(t *testing.T) []string {
	t.Helper()
	var days []string
	if err := sqlitex.DB.Model(&sqlitex.AnonymousDeviceUsage{}).Order("utc_day").Pluck("utc_day", &days).Error; err != nil {
		t.Fatal(err)
	}
	return days
}

// quotaNoon is 2026-11-10 12:00 UTC: 2026-11-08 and 2026-11-09 are finished
// days, 2026-11-10 is today.
func TestAnonymousLookupRollupAggregatesFinishedDaysAndDeletesTheirRows(t *testing.T) {
	setupQuotaUsageDB(t)
	ctx := context.Background()
	seedDeviceUsage(t,
		sqlitex.AnonymousDeviceUsage{DeviceHash: "h1", UTCDay: "2026-11-08", Used: 4},
		sqlitex.AnonymousDeviceUsage{DeviceHash: "h1", UTCDay: "2026-11-09", Used: 3},
		sqlitex.AnonymousDeviceUsage{DeviceHash: "h2", UTCDay: "2026-11-09", Used: 7},
		sqlitex.AnonymousDeviceUsage{DeviceHash: "h3", UTCDay: "2026-11-09", Used: 0},
		sqlitex.AnonymousDeviceUsage{DeviceHash: "h1", UTCDay: "2026-11-10", Used: 5},
	)

	days, err := AnonymousDeviceUsage{}.Rollup(ctx, quotaNoon)
	if err != nil {
		t.Fatal(err)
	}
	if days != 2 {
		t.Errorf("rolled up %d day(s), want 2", days)
	}
	want := []sqlitex.AnonymousLookupsDay{
		{UTCDay: "2026-11-08", Devices: 1, Lookups: 4},
		{UTCDay: "2026-11-09", Devices: 2, Lookups: 10},
	}
	got := anonymousDays(t)
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("aggregate rows %+v, want %+v", got, want)
	}
	if left := deviceUsageDays(t); len(left) != 1 || left[0] != "2026-11-10" {
		t.Fatalf("device rows left for %v, want only today's", left)
	}

	// Rerunning changes nothing.
	days, err = AnonymousDeviceUsage{}.Rollup(ctx, quotaNoon)
	if err != nil || days != 0 {
		t.Fatalf("rerun: %d day(s), %v; want 0, nil", days, err)
	}
	if got := anonymousDays(t); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("after rerun %+v, want %+v", got, want)
	}
}

// A lookup that straddled midnight writes a row for a day already
// aggregated: it is deleted and the day's aggregate stays as it was.
func TestAnonymousLookupRollupDeletesALateRowWithoutChangingTheAggregate(t *testing.T) {
	setupQuotaUsageDB(t)
	ctx := context.Background()
	seedDeviceUsage(t, sqlitex.AnonymousDeviceUsage{DeviceHash: "h1", UTCDay: "2026-11-09", Used: 3})
	if _, err := (AnonymousDeviceUsage{}).Rollup(ctx, quotaNoon); err != nil {
		t.Fatal(err)
	}
	seedDeviceUsage(t, sqlitex.AnonymousDeviceUsage{DeviceHash: "h2", UTCDay: "2026-11-09", Used: 1})

	if _, err := (AnonymousDeviceUsage{}).Rollup(ctx, quotaNoon.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got := anonymousDays(t)
	if len(got) != 1 || got[0] != (sqlitex.AnonymousLookupsDay{UTCDay: "2026-11-09", Devices: 1, Lookups: 3}) {
		t.Fatalf("aggregate rows %+v, want 2026-11-09 unchanged at 1 device, 3 lookups", got)
	}
	if left := deviceUsageDays(t); len(left) != 0 {
		t.Fatalf("device rows left for %v, want none", left)
	}
}

func TestAnonymousLookupRollupWritesNoRowForADayWithoutLookups(t *testing.T) {
	setupQuotaUsageDB(t)
	seedDeviceUsage(t, sqlitex.AnonymousDeviceUsage{DeviceHash: "h1", UTCDay: "2026-11-10", Used: 2})

	days, err := AnonymousDeviceUsage{}.Rollup(context.Background(), quotaNoon)
	if err != nil || days != 0 {
		t.Fatalf("%d day(s), %v; want 0, nil", days, err)
	}
	if got := anonymousDays(t); len(got) != 0 {
		t.Fatalf("aggregate rows %+v, want none", got)
	}
}
