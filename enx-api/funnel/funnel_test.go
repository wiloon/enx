package funnel

import (
	"context"
	"testing"
	"time"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func ptr(n int) *int { return &n }

func show(n *int) any {
	if n == nil {
		return nil
	}
	return *n
}

// 2026-10-05 is a Monday; by 2026-11-26 every window of its week is over.
var now = at("2026-11-26T12:00:00Z")

// cohortOf returns the cohort whose week starts on weekStart.
func cohortOf(t *testing.T, cohorts []Cohort, weekStart string) Cohort {
	t.Helper()
	for _, c := range cohorts {
		if c.WeekStart.Format(time.DateOnly) == weekStart {
			return c
		}
	}
	t.Fatalf("no cohort %s", weekStart)
	return Cohort{}
}

func TestCohortsAreTheTwelveLatestUTCWeeksNewestFirst(t *testing.T) {
	got := Cohorts(nil, now)

	if len(got) != 12 {
		t.Fatalf("len = %d, want 12", len(got))
	}
	for i, c := range got {
		want := at("2026-11-23T00:00:00Z").AddDate(0, 0, -7*i)
		if !c.WeekStart.Equal(want) {
			t.Errorf("cohort %d starts %s, want %s", i, c.WeekStart, want)
		}
	}
}

func TestAMemberBelongsToTheUTCWeekOfTheSignUp(t *testing.T) {
	got := Cohorts([]Member{
		{SignedUpAt: at("2026-11-16T00:00:00Z")},      // Monday 00:00
		{SignedUpAt: at("2026-11-22T23:59:59Z")},      // Sunday night
		{SignedUpAt: at("2026-11-23T07:00:00+08:00")}, // still Sunday in UTC
		{SignedUpAt: at("2026-11-23T00:00:00Z")},      // the next week
		{SignedUpAt: at("2026-09-06T23:59:59Z")},      // before the 12 weeks
	}, now)

	if n := cohortOf(t, got, "2026-11-16").SignedUp; n != 3 {
		t.Errorf("week of 11-16: signed up = %d, want 3", n)
	}
	if n := cohortOf(t, got, "2026-11-23").SignedUp; n != 1 {
		t.Errorf("week of 11-23: signed up = %d, want 1", n)
	}
	total := 0
	for _, c := range got {
		total += c.SignedUp
	}
	if total != 4 {
		t.Errorf("members in all cohorts = %d, want 4", total)
	}
}

func TestLookupDaySteps(t *testing.T) {
	signedUp := at("2026-10-05T20:00:00Z")
	tests := []struct {
		name                           string
		days                           []string
		first, threeDays, week2, week4 int
	}{
		{"never looked up", nil, 0, 0, 0, 0},
		{"one day, long after", []string{"2026-11-20"}, 1, 0, 0, 0},
		{"3 days within index 0 to 13", []string{"2026-10-05", "2026-10-06", "2026-10-11"}, 1, 1, 0, 0},
		{"the third day at index 14", []string{"2026-10-05", "2026-10-06", "2026-10-19"}, 1, 0, 0, 0},
		{"a repeated day counts once", []string{"2026-10-05", "2026-10-06", "2026-10-06"}, 1, 0, 0, 0},
		{"a day before sign-up is index 0, and its own day", []string{"2026-10-04", "2026-10-05", "2026-10-06"}, 1, 1, 0, 0},
		{"index 6 is not week 2", []string{"2026-10-11"}, 1, 0, 0, 0},
		{"index 7 is week 2", []string{"2026-10-12"}, 1, 0, 1, 0},
		{"index 13 is week 2", []string{"2026-10-18"}, 1, 0, 1, 0},
		{"index 14 is neither", []string{"2026-10-19"}, 1, 0, 0, 0},
		{"index 20 is not week 4", []string{"2026-10-25"}, 1, 0, 0, 0},
		{"index 21 is week 4", []string{"2026-10-26"}, 1, 0, 0, 1},
		{"index 27 is week 4", []string{"2026-11-01"}, 1, 0, 0, 1},
		{"index 28 is not week 4", []string{"2026-11-02"}, 1, 0, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := cohortOf(t, Cohorts([]Member{{SignedUpAt: signedUp, LookupDays: tt.days}}, now), "2026-10-05")

			if c.FirstLookup != tt.first {
				t.Errorf("first lookup = %d, want %d", c.FirstLookup, tt.first)
			}
			for _, step := range []struct {
				name string
				got  *int
				want int
			}{
				{"3 lookup days", c.ThreeLookupDays, tt.threeDays},
				{"week 2", c.Week2, tt.week2},
				{"week 4", c.Week4, tt.week4},
			} {
				if step.got == nil || *step.got != step.want {
					t.Errorf("%s = %v, want %d", step.name, show(step.got), step.want)
				}
			}
		})
	}
}

func TestAIAndPaymentSteps(t *testing.T) {
	signedUp := at("2026-10-06T08:00:00Z")
	later, passed := now.Add(time.Hour), now.Add(-time.Hour)
	tests := []struct {
		name                     string
		member                   Member
		aiCall, trialEnded, paid int
	}{
		{"nothing", Member{}, 0, 0, 0},
		{"used AI", Member{UsedAI: true}, 1, 0, 0},
		{"paid", Member{Paid: true}, 0, 0, 1},
		{"running trial", Member{TrialExpiresAt: &later, TrialBalance: 5}, 0, 0, 0},
		{"trial used up", Member{TrialExpiresAt: &later, TrialBalance: 0}, 0, 1, 0},
		{"trial expired with credits left", Member{TrialExpiresAt: &passed, TrialBalance: 5}, 0, 1, 0},
		{"trial expiring right now", Member{TrialExpiresAt: &now, TrialBalance: 5}, 0, 1, 0},
		{"never had a trial", Member{TrialBalance: 0}, 0, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.member.SignedUpAt = signedUp
			c := cohortOf(t, Cohorts([]Member{tt.member}, now), "2026-10-05")

			if c.FirstAICall != tt.aiCall || c.TrialEnded != tt.trialEnded || c.FirstPayment != tt.paid {
				t.Errorf("ai, trial ended, paid = %d, %d, %d, want %d, %d, %d",
					c.FirstAICall, c.TrialEnded, c.FirstPayment, tt.aiCall, tt.trialEnded, tt.paid)
			}
		})
	}
}

func TestWindowedStepsStayEmptyUntilTheWholeWindowHasPassed(t *testing.T) {
	// Week of Monday 2026-10-05: +22 days is 10-27, +36 days is 11-10.
	tests := []struct {
		now              string
		twoWeeks, fourth *int
	}{
		{"2026-10-26T23:59:59Z", nil, nil},
		{"2026-10-27T00:00:00Z", ptr(0), nil},
		{"2026-11-09T23:59:59Z", ptr(0), nil},
		{"2026-11-10T00:00:00Z", ptr(0), ptr(0)},
	}
	for _, tt := range tests {
		t.Run(tt.now, func(t *testing.T) {
			c := cohortOf(t, Cohorts(nil, at(tt.now)), "2026-10-05")

			if show(c.ThreeLookupDays) != show(tt.twoWeeks) || show(c.Week2) != show(tt.twoWeeks) || show(c.Week4) != show(tt.fourth) {
				t.Errorf("3 days, week 2, week 4 = %v, %v, %v, want %v, %v, %v",
					show(c.ThreeLookupDays), show(c.Week2), show(c.Week4),
					show(tt.twoWeeks), show(tt.twoWeeks), show(tt.fourth))
			}
		})
	}
}

type fakeRepo struct {
	accounts []Account
	activity Activity
}

func (f fakeRepo) Accounts(context.Context) ([]Account, error) { return f.accounts, nil }
func (f fakeRepo) Activity(context.Context) (Activity, error)  { return f.activity, nil }

// Every step starts from the accounts: admins and users without an account
// are in no count.
func TestReportCountsNeitherAdminsNorUsersWithoutAnAccount(t *testing.T) {
	signedUp := at("2026-10-06T08:00:00Z")
	repo := fakeRepo{
		accounts: []Account{
			{ID: "u1", AuthSubject: "sub-user", SignedUpAt: signedUp},
			{ID: "a1", AuthSubject: "sub-admin", SignedUpAt: signedUp},
		},
		activity: Activity{
			LookupDays: map[string][]string{"u1": {"2026-10-13"}, "a1": {"2026-10-13"}, "deleted": {"2026-10-13"}},
			AICallers:  map[string]bool{"u1": true, "a1": true, "deleted": true},
			Payers:     map[string]bool{"a1": true, "deleted": true},
			Trials:     map[string]Trial{"u1": {ExpiresAt: signedUp, Balance: 3}, "a1": {ExpiresAt: signedUp}},
		},
	}
	svc := NewService(repo, func(sub string) bool { return sub == "sub-admin" }, func() time.Time { return now })

	cohorts, err := svc.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	c := cohortOf(t, cohorts, "2026-10-05")
	if c.SignedUp != 1 || c.FirstLookup != 1 || *c.Week2 != 1 || c.FirstAICall != 1 || c.TrialEnded != 1 || c.FirstPayment != 0 {
		t.Errorf("cohort = %+v (week 2 %v), want only u1 counted", c, show(c.Week2))
	}
}
