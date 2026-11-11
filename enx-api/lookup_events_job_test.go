package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"enx-api/repo"
	"enx-api/userstats"
	"enx-api/utils/sqlitex"
)

// Active users are rolled up before the expired events are deleted: the
// first day inside retention counts, in its MAU, a user whose only lookup is
// about to expire (ADR-059 Decision 4).
func TestLookupEventJobRollsUpActiveUsersBeforeDeleting(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "job.db"))
	now := time.Date(2026, 10, 16, 1, 30, 0, 0, time.UTC)
	const retention = 31 // cutoff 2026-09-15 01:30; first full day 2026-09-16
	ctx := context.Background()
	for _, e := range []sqlitex.LookupEvent{
		{UserID: "expiring", At: time.Date(2026, 9, 15, 0, 30, 0, 0, time.UTC).UnixMilli(), Outcome: "allowed"},
		{UserID: "kept", At: time.Date(2026, 9, 16, 9, 0, 0, 0, time.UTC).UnixMilli(), Outcome: "allowed"},
	} {
		if err := repo.AddLookupEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}

	svc := userstats.NewService(repo.UserStats{}, func() time.Time { return now })
	runLookupEventJob(ctx, now, retention, svc)

	days, err := repo.UserStats{}.ActiveDays(ctx, "2026-09-16", "2026-09-16")
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 1 || days[0].MAU != 2 {
		t.Fatalf("2026-09-16 = %+v, want MAU 2 (the expiring user still counted)", days)
	}
	if _, ok, _ := (repo.UserStats{}).FirstEvent(ctx); !ok {
		t.Fatal("every event was deleted")
	}
	if first, _, _ := (repo.UserStats{}).FirstEvent(ctx); first.Before(now.AddDate(0, 0, -retention)) {
		t.Errorf("an event past retention is still there: %v", first)
	}
}

// ADR-079 Decision 5: the daily quota counter is kept as long as lookup
// events, by the same hourly job.
func TestStatsJobDeletesQuotaUsageOutsideTheLookupEventRetention(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "job.db"))
	now := time.Date(2026, 10, 16, 1, 30, 0, 0, time.UTC)
	const retention = 31 // the window starts 2026-09-15 01:30
	for _, day := range []string{"2026-09-14", "2026-09-15", "2026-10-16"} {
		if err := sqlitex.DB.Create(&sqlitex.DictionaryQuotaUsage{UserID: "u1", UTCDay: day, Used: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}

	runStatsJobs(context.Background(), now, time.Hour, retention, userstats.NewService(repo.UserStats{}, func() time.Time { return now }))

	var days []string
	sqlitex.DB.Model(&sqlitex.DictionaryQuotaUsage{}).Order("utc_day").Pluck("utc_day", &days)
	if len(days) != 2 || days[0] != "2026-09-15" || days[1] != "2026-10-16" {
		t.Fatalf("days left %v, want [2026-09-15 2026-10-16]", days)
	}
}
