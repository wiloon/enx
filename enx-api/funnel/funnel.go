// Package funnel counts, per weekly sign-up cohort, how many users reached
// each step from sign-up to first payment. It is read-only over data other
// packages write.
package funnel

import (
	"context"
	"time"
)

// Member is the facts about one cohort member.
type Member struct {
	SignedUpAt     time.Time
	LookupDays     []string
	UsedAI         bool
	Paid           bool
	TrialExpiresAt *time.Time
	TrialBalance   int64
}

// Cohort is one sign-up week's count at each step.
type Cohort struct {
	WeekStart       time.Time
	SignedUp        int
	FirstLookup     int
	ThreeLookupDays *int
	Week2           *int
	Week4           *int
	FirstAICall     int
	TrialEnded      int
	FirstPayment    int
}

// cohortCount is how many sign-up weeks the funnel shows, the current one
// included.
const cohortCount = 12

// A windowed step is measurable once every member of the week has had its
// whole window plus one day for time zones: this many days after the week's
// start.
const (
	twoWeekStepsAfterDays = 22
	week4AfterDays        = 36
)

// Cohorts returns the latest sign-up weeks (UTC, Monday first), newest first,
// each with its members counted per step. A step does not require the earlier
// ones. A windowed step that is not yet measurable is nil.
func Cohorts(members []Member, now time.Time) []Cohort {
	current := weekStart(now)
	cohorts := make([]Cohort, cohortCount)
	index := make(map[time.Time]int, cohortCount)
	for i := range cohorts {
		start := current.AddDate(0, 0, -7*i)
		cohorts[i].WeekStart = start
		index[start] = i
		if !now.Before(start.AddDate(0, 0, twoWeekStepsAfterDays)) {
			cohorts[i].ThreeLookupDays, cohorts[i].Week2 = new(int), new(int)
		}
		if !now.Before(start.AddDate(0, 0, week4AfterDays)) {
			cohorts[i].Week4 = new(int)
		}
	}
	for _, m := range members {
		if i, ok := index[weekStart(m.SignedUpAt)]; ok {
			cohorts[i].add(m, now)
		}
	}
	return cohorts
}

func (c *Cohort) add(m Member, now time.Time) {
	days := dayIndexes(m)
	var inFirstTwoWeeks int
	var week2, week4 bool
	for _, i := range days {
		if i <= 13 {
			inFirstTwoWeeks++
		}
		week2 = week2 || (i >= 7 && i <= 13)
		week4 = week4 || (i >= 21 && i <= 27)
	}

	c.SignedUp++
	count(&c.FirstLookup, len(days) > 0)
	count(c.ThreeLookupDays, inFirstTwoWeeks >= 3)
	count(c.Week2, week2)
	count(c.Week4, week4)
	count(&c.FirstAICall, m.UsedAI)
	count(&c.TrialEnded, m.TrialExpiresAt != nil && (m.TrialBalance == 0 || !now.Before(*m.TrialExpiresAt)))
	count(&c.FirstPayment, m.Paid)
}

// count adds one to step when the member reached it. A nil step is not yet
// measurable and stays nil.
func count(step *int, reached bool) {
	if step != nil && reached {
		*step++
	}
}

// dayIndexes returns the day index of each distinct lookup day: the local
// date minus the UTC date of the sign-up, in days. A date before it (a user
// west of UTC) has index 0.
func dayIndexes(m Member) map[string]int {
	signUpDate := utcDate(m.SignedUpAt)
	out := make(map[string]int, len(m.LookupDays))
	for _, day := range m.LookupDays {
		date, err := time.Parse(time.DateOnly, day)
		if err != nil {
			continue
		}
		out[day] = max(0, int(date.Sub(signUpDate)/(24*time.Hour)))
	}
	return out
}

func utcDate(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// weekStart is the Monday 00:00 UTC that starts t's week.
func weekStart(t time.Time) time.Time {
	date := utcDate(t)
	return date.AddDate(0, 0, -((int(date.Weekday()) + 6) % 7))
}

// Account is a user who still has an account.
type Account struct {
	ID          string
	AuthSubject string
	SignedUpAt  time.Time
}

// Trial is a sign-up trial's expiry and what is left of it.
type Trial struct {
	ExpiresAt time.Time
	Balance   int64
}

// Activity is what users did, keyed by user id.
type Activity struct {
	LookupDays map[string][]string
	AICallers  map[string]bool
	Payers     map[string]bool
	Trials     map[string]Trial
}

// Repository reads the data the funnel counts.
type Repository interface {
	Accounts(ctx context.Context) ([]Account, error)
	Activity(ctx context.Context) (Activity, error)
}

// Service builds the funnel report.
type Service struct {
	repo    Repository
	isAdmin func(authSubject string) bool
	now     func() time.Time
}

// NewService returns a Service. Accounts isAdmin reports are in no count.
func NewService(repo Repository, isAdmin func(authSubject string) bool, now func() time.Time) *Service {
	return &Service{repo: repo, isAdmin: isAdmin, now: now}
}

// Report returns the funnel. Its members come from the accounts alone, so
// activity left behind by a deleted account is in no count.
func (s *Service) Report(ctx context.Context) ([]Cohort, error) {
	accounts, err := s.repo.Accounts(ctx)
	if err != nil {
		return nil, err
	}
	activity, err := s.repo.Activity(ctx)
	if err != nil {
		return nil, err
	}
	members := make([]Member, 0, len(accounts))
	for _, a := range accounts {
		if s.isAdmin(a.AuthSubject) {
			continue
		}
		m := Member{
			SignedUpAt: a.SignedUpAt,
			LookupDays: activity.LookupDays[a.ID],
			UsedAI:     activity.AICallers[a.ID],
			Paid:       activity.Payers[a.ID],
		}
		if trial, ok := activity.Trials[a.ID]; ok {
			m.TrialExpiresAt, m.TrialBalance = &trial.ExpiresAt, trial.Balance
		}
		members = append(members, m)
	}
	return Cohorts(members, s.now()), nil
}
