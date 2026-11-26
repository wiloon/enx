package adapters

import (
	"context"
	"testing"
	"time"

	"enx-api/funnel"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	now = time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	// Monday of the cohort under test; every window of its week is over.
	signedUp = time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)
)

func newDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	// Each connection to :memory: is its own database.
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(&sqlitex.User{}, &sqlitex.DailyStat{}, &sqlitex.LookupEvent{},
		&sqlitex.CreditTransaction{}, &sqlitex.CreditAccount{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func seed(t *testing.T, db *gorm.DB, rows ...any) {
	t.Helper()
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func user(id string) *sqlitex.User {
	return &sqlitex.User{Id: id, AuthSubject: "sub-" + id, CreatedAt: signedUp}
}

func rolledUp(userID, date string, lookups int64) *sqlitex.DailyStat {
	return &sqlitex.DailyStat{UserID: userID, Date: date, WordLookups: lookups}
}

func event(userID, utc string, offsetMinutes int, outcome string) *sqlitex.LookupEvent {
	at, err := time.Parse(time.RFC3339, utc)
	if err != nil {
		panic(err)
	}
	return &sqlitex.LookupEvent{UserID: userID, At: at.UnixMilli(), TZOffsetMinutes: offsetMinutes, Outcome: outcome}
}

func ledger(id, userID, kind string) *sqlitex.CreditTransaction {
	return &sqlitex.CreditTransaction{Id: id, UserId: userID, Type: kind, Amount: 1, CreatedAt: signedUp.UnixMilli()}
}

// report is the funnel's cohort of the week of signedUp, read from db.
func report(t *testing.T, db *gorm.DB) funnel.Cohort {
	t.Helper()
	svc := funnel.NewService(Repo{DB: db},
		func(sub string) bool { return sub == "sub-admin" },
		func() time.Time { return now })
	cohorts, err := svc.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cohorts {
		if c.WeekStart.Format(time.DateOnly) == "2026-10-05" {
			return c
		}
	}
	t.Fatal("no cohort 2026-10-05")
	return funnel.Cohort{}
}

func TestSignUpTimeKeepsItsInstant(t *testing.T) {
	db := newDB(t)
	// Monday 07:00 in Beijing is still Sunday in UTC: the week before.
	late := user("late")
	late.CreatedAt = time.Date(2026, 10, 12, 7, 0, 0, 0, time.FixedZone("CST", 8*3600))
	seed(t, db, user("u1"), late)

	if c := report(t, db); c.SignedUp != 2 {
		t.Errorf("signed up = %d, want 2", c.SignedUp)
	}
}

func TestLookupDaysComeFromBothSources(t *testing.T) {
	tests := []struct {
		name string
		rows []any
		// 1 when the user has the 3 distinct lookup days.
		threeDays int
		first     int
	}{
		{
			name: "days only in daily_stats, their events already deleted",
			rows: []any{rolledUp("u1", "2026-10-05", 4), rolledUp("u1", "2026-10-06", 1), rolledUp("u1", "2026-10-07", 2)},

			first: 1, threeDays: 1,
		},
		{
			name: "days only in lookup_events, not yet rolled up",
			rows: []any{
				event("u1", "2026-10-05T10:00:00Z", 0, "allowed"),
				event("u1", "2026-10-06T10:00:00Z", 0, "allowed"),
				event("u1", "2026-10-07T10:00:00Z", 0, "allowed"),
			},
			first: 1, threeDays: 1,
		},
		{
			name: "a day present in both counts once",
			rows: []any{
				rolledUp("u1", "2026-10-05", 1), event("u1", "2026-10-05T10:00:00Z", 0, "allowed"),
				rolledUp("u1", "2026-10-06", 1), event("u1", "2026-10-06T10:00:00Z", 0, "allowed"),
			},
			first: 1, threeDays: 0,
		},
		{
			name: "an event's day is its local date",
			rows: []any{
				// 20:00 UTC at +08:00 is the next local day.
				event("u1", "2026-10-05T10:00:00Z", 480, "allowed"),
				event("u1", "2026-10-05T20:00:00Z", 480, "allowed"),
				event("u1", "2026-10-07T10:00:00Z", 480, "allowed"),
			},
			first: 1, threeDays: 1,
		},
		{
			name: "a refused lookup is no lookup day",
			rows: []any{event("u1", "2026-10-05T10:00:00Z", 0, "rejected")},
		},
		{
			name: "a day with statistics but no word lookup is no lookup day",
			rows: []any{rolledUp("u1", "2026-10-05", 0)},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newDB(t)
			seed(t, db, user("u1"))
			seed(t, db, tt.rows...)

			c := report(t, db)

			if c.FirstLookup != tt.first || *c.ThreeLookupDays != tt.threeDays {
				t.Errorf("first lookup, 3 days = %d, %d, want %d, %d", c.FirstLookup, *c.ThreeLookupDays, tt.first, tt.threeDays)
			}
		})
	}
}

func TestLedgerRowsDecideFirstAICallAndFirstPayment(t *testing.T) {
	tests := []struct {
		kind         string
		aiCall, paid int
	}{
		{"SETTLE", 1, 0},
		{"CONSUME", 1, 0},
		{"GRANT_SUBSCRIPTION", 0, 1},
		{"GRANT_TOPUP", 0, 1},
		{"GRANT_TRIAL", 0, 0},
		{"GRANT_ADMIN", 0, 0},
		{"GRANT_REFERRAL_REWARD", 0, 0},
		{"REFUND", 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			db := newDB(t)
			seed(t, db, user("u1"), ledger("t1", "u1", tt.kind))

			c := report(t, db)

			if c.FirstAICall != tt.aiCall || c.FirstPayment != tt.paid {
				t.Errorf("ai call, payment = %d, %d, want %d, %d", c.FirstAICall, c.FirstPayment, tt.aiCall, tt.paid)
			}
		})
	}
}

func TestTrialEndedReadsTheCreditAccount(t *testing.T) {
	later, passed := now.Unix()+3600, now.Unix()-3600
	db := newDB(t)
	seed(t, db,
		user("running"), user("used-up"), user("expired"), user("no-trial"),
		&sqlitex.CreditAccount{UserId: "running", TrialBalance: 5, TrialExpiresAt: &later},
		&sqlitex.CreditAccount{UserId: "used-up", TrialBalance: 0, TrialExpiresAt: &later},
		&sqlitex.CreditAccount{UserId: "expired", TrialBalance: 5, TrialExpiresAt: &passed},
		&sqlitex.CreditAccount{UserId: "no-trial"},
	)

	if c := report(t, db); c.TrialEnded != 2 {
		t.Errorf("trial ended = %d, want 2 (used up and expired)", c.TrialEnded)
	}
}

func TestAdminsAndDeletedAccountsAreInNoCount(t *testing.T) {
	db := newDB(t)
	expired := now.Unix() - 3600
	seed(t, db, user("u1"), user("admin"))
	// "deleted" has rows left behind but no users row.
	for _, id := range []string{"admin", "deleted"} {
		seed(t, db,
			rolledUp(id, "2026-10-13", 1),
			event(id, "2026-10-26T10:00:00Z", 0, "allowed"),
			ledger(id+"-settle", id, "SETTLE"),
			ledger(id+"-topup", id, "GRANT_TOPUP"),
			&sqlitex.CreditAccount{UserId: id, TrialExpiresAt: &expired},
		)
	}

	c := report(t, db)

	if c.SignedUp != 1 || c.FirstLookup != 0 || *c.ThreeLookupDays != 0 || *c.Week2 != 0 || *c.Week4 != 0 ||
		c.FirstAICall != 0 || c.TrialEnded != 0 || c.FirstPayment != 0 {
		t.Errorf("cohort = %+v, want only u1 signed up", c)
	}
}
