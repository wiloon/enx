package repo

import (
	"context"
	"fmt"
	"testing"
	"time"

	"enx-api/userstats"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newUserStatsDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.User{}, &sqlitex.LookupEvent{}, &sqlitex.ActiveUsersDay{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

var seq int

func seedUser(t *testing.T, clerkID string, createdAt time.Time) {
	t.Helper()
	seq++
	id := fmt.Sprintf("user-%d", seq)
	if err := sqlitex.DB.Create(&sqlitex.User{
		Id: id, ClerkUserID: clerkID, Name: id, Email: id, CreatedAt: createdAt,
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func seedLookupEvent(t *testing.T, userID string, at time.Time, outcome string) {
	t.Helper()
	if err := AddLookupEvent(context.Background(), sqlitex.LookupEvent{
		UserID: userID, At: at.UnixMilli(), Outcome: outcome,
	}); err != nil {
		t.Fatal(err)
	}
}

func utcAt(month time.Month, day, hour, minute int) time.Time {
	return time.Date(2026, month, day, hour, minute, 0, 0, time.UTC)
}

var beijing = time.FixedZone("CST", 8*3600)

// A 429-rejected lookup still makes its user active (ADR-058 Decision 1).
func TestActiveUsersCountsDistinctUsersRejectedIncluded(t *testing.T) {
	newUserStatsDB(t)
	seedLookupEvent(t, "u1", utcAt(10, 15, 0, 0), "allowed")
	seedLookupEvent(t, "u1", utcAt(10, 15, 9, 0), "allowed")
	seedLookupEvent(t, "u2", utcAt(10, 15, 23, 59), "rejected")
	seedLookupEvent(t, "u3", utcAt(10, 16, 0, 0), "allowed") // the next day

	n, err := UserStats{}.ActiveUsers(context.Background(), utcAt(10, 15, 0, 0), utcAt(10, 16, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("active users on 2026-10-15 = %d, want 2 (u1 once, u2 rejected)", n)
	}
}

// A user is a users row with a Clerk id; created_at is stored with the
// server's offset and still filed under its UTC day.
func TestUserCountsSkipUsersWithoutAClerkIDAndUseUTCDays(t *testing.T) {
	newUserStatsDB(t)
	seedUser(t, "c1", time.Date(2026, 10, 16, 7, 30, 0, 0, beijing)) // 2026-10-15 23:30 UTC
	seedUser(t, "c2", utcAt(10, 16, 0, 0))
	seedUser(t, "", utcAt(10, 15, 12, 0)) // legacy account, no Clerk id
	seedUser(t, "c3", utcAt(10, 14, 12, 0))
	ctx := context.Background()
	store := UserStats{}

	total, err := store.UsersTotal(ctx, utcAt(10, 16, 0, 0))
	if err != nil || total != 2 {
		t.Errorf("users before 2026-10-16 = %d, %v; want 2", total, err)
	}
	fresh, err := store.NewUsers(ctx, utcAt(10, 15, 0, 0), utcAt(10, 16, 0, 0))
	if err != nil || fresh != 1 {
		t.Errorf("new users on 2026-10-15 = %d, %v; want 1", fresh, err)
	}
	perDay, err := store.SignupsPerDay(ctx, utcAt(10, 14, 0, 0), utcAt(10, 17, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{"2026-10-14": 1, "2026-10-15": 1, "2026-10-16": 1}
	if len(perDay) != len(want) {
		t.Errorf("signups per day = %v, want %v", perDay, want)
	}
	for d, n := range want {
		if perDay[d] != n {
			t.Errorf("signups on %s = %d, want %d", d, perDay[d], n)
		}
	}
	first, ok, err := store.FirstSignup(ctx)
	if err != nil || !ok || !first.Equal(utcAt(10, 14, 12, 0)) {
		t.Errorf("first signup = %v, %v, %v; want 2026-10-14 12:00 UTC", first, ok, err)
	}
}

func TestFirstEventAndFirstSignupOnAnEmptyDatabase(t *testing.T) {
	newUserStatsDB(t)
	ctx := context.Background()
	if _, ok, err := (UserStats{}).FirstEvent(ctx); err != nil || ok {
		t.Errorf("FirstEvent = %v, %v; want none", ok, err)
	}
	if _, ok, err := (UserStats{}).FirstSignup(ctx); err != nil || ok {
		t.Errorf("FirstSignup = %v, %v; want none", ok, err)
	}

	seedLookupEvent(t, "u1", utcAt(10, 15, 9, 0), "allowed")
	seedLookupEvent(t, "u1", utcAt(10, 13, 9, 0), "rejected")
	first, ok, err := UserStats{}.FirstEvent(ctx)
	if err != nil || !ok || !first.Equal(utcAt(10, 13, 9, 0)) {
		t.Errorf("FirstEvent = %v, %v, %v; want 2026-10-13 09:00 UTC", first, ok, err)
	}
}

// Saving a day twice leaves one row with the last numbers, so a rerun of
// the rollup is harmless.
func TestSaveActiveDayReplacesTheRow(t *testing.T) {
	newUserStatsDB(t)
	ctx := context.Background()
	store := UserStats{}
	for _, d := range []userstats.ActiveDay{
		{Date: "2026-10-14", DAU: 1, WAU: 1, MAU: 1},
		{Date: "2026-10-15", DAU: 1, WAU: 2, MAU: 3},
		{Date: "2026-10-15", DAU: 4, WAU: 5, MAU: 6},
	} {
		if err := store.SaveActiveDay(ctx, d); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.ActiveDays(ctx, "2026-10-15", "2026-10-16")
	if err != nil {
		t.Fatal(err)
	}
	want := userstats.ActiveDay{Date: "2026-10-15", DAU: 4, WAU: 5, MAU: 6}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("ActiveDays = %+v, want [%+v]", got, want)
	}
}
