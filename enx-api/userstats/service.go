// Package userstats answers how many people use ENX (ADR-058, data source
// per ADR-059): total users, new users and active users, now and per UTC day.
//
// An active user on a UTC day is one with at least one lookup event that
// day, a 429-rejected lookup included. A user is a users row with a Clerk
// id. Live numbers come from lookup_events; finished days are rolled up into
// active_users_daily before their events expire.
package userstats

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// DateLayout is a UTC day, YYYY-MM-DD.
const DateLayout = "2006-01-02"

// Store is what the service reads and writes. Time ranges are [from, to).
type Store interface {
	// UsersTotal counts users created before before.
	UsersTotal(ctx context.Context, before time.Time) (int64, error)
	// NewUsers counts users created in [from, to).
	NewUsers(ctx context.Context, from, to time.Time) (int64, error)
	// ActiveUsers counts distinct users with a lookup event in [from, to).
	ActiveUsers(ctx context.Context, from, to time.Time) (int64, error)
	// SignupsPerDay counts users created in [from, to) by UTC day.
	SignupsPerDay(ctx context.Context, from, to time.Time) (map[string]int64, error)
	// FirstSignup is when the earliest user was created; false when none.
	FirstSignup(ctx context.Context) (time.Time, bool, error)
	// FirstEvent is the earliest lookup event still kept; false when none.
	FirstEvent(ctx context.Context) (time.Time, bool, error)
	// ActiveDays reads the rolled-up days from..to (inclusive).
	ActiveDays(ctx context.Context, from, to string) ([]ActiveDay, error)
	// SaveActiveDay writes one rolled-up day, replacing an existing row.
	SaveActiveDay(ctx context.Context, d ActiveDay) error
}

// Counts is one number per window: the last 1, 7 and 30 UTC days, today
// included.
type Counts struct {
	Day, Week, Month int64
}

// Snapshot is the current numbers, the Prometheus gauges.
type Snapshot struct {
	UsersTotal int64
	Active     Counts
	New        Counts
}

// ActiveDay is one finished UTC day's active users, as rolled up.
type ActiveDay struct {
	Date          string
	DAU, WAU, MAU int64
}

// Service computes the user statistics.
type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store, now func() time.Time) *Service {
	return &Service{store: store, now: now}
}

// windowDays are the lengths of the three windows.
var windowDays = [3]int{1, 7, 30}

// Current is the numbers for the windows ending with today (UTC).
func (s *Service) Current(ctx context.Context) (Snapshot, error) {
	today := startOfDay(s.now())
	snap := Snapshot{}
	total, err := s.store.UsersTotal(ctx, today.AddDate(0, 0, 1))
	if err != nil {
		return Snapshot{}, err
	}
	snap.UsersTotal = total

	active, err := s.activeEnding(ctx, today)
	if err != nil {
		return Snapshot{}, err
	}
	snap.Active = active

	var fresh [3]int64
	for i, n := range windowDays {
		from, to := window(today, n)
		if fresh[i], err = s.store.NewUsers(ctx, from, to); err != nil {
			return Snapshot{}, err
		}
	}
	snap.New = Counts{Day: fresh[0], Week: fresh[1], Month: fresh[2]}
	return snap, nil
}

// activeEnding counts active users in the three windows ending with day.
func (s *Service) activeEnding(ctx context.Context, day time.Time) (Counts, error) {
	var n [3]int64
	for i, days := range windowDays {
		from, to := window(day, days)
		var err error
		if n[i], err = s.store.ActiveUsers(ctx, from, to); err != nil {
			return Counts{}, err
		}
	}
	return Counts{Day: n[0], Week: n[1], Month: n[2]}, nil
}

// Rollup writes DAU / WAU / MAU into active_users_daily for every finished
// UTC day not rolled up yet (ADR-059 Decision 4), and returns how many days
// it wrote. It runs before the lookup events past retentionDays are deleted.
//
// It starts at the first day that has events, so the days before launch get
// no rows, and never earlier than the first day all of whose events are still
// kept. A day already rolled up is never recomputed: once its oldest events
// expire, a recount would make WAU and MAU too small.
func (s *Service) Rollup(ctx context.Context, retentionDays int) (int, error) {
	now := s.now().UTC()
	firstEvent, ok, err := s.store.FirstEvent(ctx)
	if err != nil || !ok {
		return 0, err
	}
	cutoff := now.AddDate(0, 0, -retentionDays)
	first := startOfDay(cutoff)
	if first.Before(cutoff) {
		first = first.AddDate(0, 0, 1)
	}
	if d := startOfDay(firstEvent); d.After(first) {
		first = d
	}
	last := startOfDay(now).AddDate(0, 0, -1)
	if first.After(last) {
		return 0, nil
	}

	existing, err := s.store.ActiveDays(ctx, first.Format(DateLayout), last.Format(DateLayout))
	if err != nil {
		return 0, err
	}
	done := make(map[string]bool, len(existing))
	for _, d := range existing {
		done[d.Date] = true
	}

	written := 0
	for day := first; !day.After(last); day = day.AddDate(0, 0, 1) {
		date := day.Format(DateLayout)
		if done[date] {
			continue
		}
		active, err := s.activeEnding(ctx, day)
		if err != nil {
			return written, err
		}
		if err := s.store.SaveActiveDay(ctx, ActiveDay{Date: date, DAU: active.Day, WAU: active.Week, MAU: active.Month}); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

// MaxDailyRange is the most days Daily returns in one call.
const MaxDailyRange = 1000

// ErrBadRange is a from / to that is malformed, reversed or too long.
var ErrBadRange = errors.New("invalid date range")

// Day is one UTC day of the history (ADR-058 Decision 4).
type Day struct {
	Date       string `json:"date"`
	UsersTotal int64  `json:"users_total"`
	NewUsers   int64  `json:"new_users"`
	DAU        int64  `json:"dau"`
	WAU        int64  `json:"wau"`
	MAU        int64  `json:"mau"`
}

// Daily is one row per UTC day from..to (YYYY-MM-DD, inclusive), ascending.
// An empty from is the first signup day, an empty to is today, and a to past
// today stops at today. Past days' active users come from the rollup, and
// are zero for a day without a rollup row; today's are computed live.
func (s *Service) Daily(ctx context.Context, from, to string) ([]Day, error) {
	today := startOfDay(s.now())
	first, last := today, today
	if from == "" {
		signup, ok, err := s.store.FirstSignup(ctx)
		if err != nil {
			return nil, err
		}
		if ok {
			first = startOfDay(signup)
		}
	} else {
		d, err := parseDay(from)
		if err != nil {
			return nil, err
		}
		first = d
	}
	if to != "" {
		d, err := parseDay(to)
		if err != nil {
			return nil, err
		}
		if d.Before(today) {
			last = d
		}
	}
	if first.After(last) {
		return nil, fmt.Errorf("%w: from is after to", ErrBadRange)
	}
	if n := int(last.Sub(first).Hours()/24) + 1; n > MaxDailyRange {
		return nil, fmt.Errorf("%w: %d days, at most %d", ErrBadRange, n, MaxDailyRange)
	}

	end := last.AddDate(0, 0, 1)
	total, err := s.store.UsersTotal(ctx, first)
	if err != nil {
		return nil, err
	}
	signups, err := s.store.SignupsPerDay(ctx, first, end)
	if err != nil {
		return nil, err
	}
	rolled, err := s.store.ActiveDays(ctx, first.Format(DateLayout), last.Format(DateLayout))
	if err != nil {
		return nil, err
	}
	active := make(map[string]ActiveDay, len(rolled)+1)
	for _, d := range rolled {
		active[d.Date] = d
	}
	if last.Equal(today) {
		live, err := s.activeEnding(ctx, today)
		if err != nil {
			return nil, err
		}
		date := today.Format(DateLayout)
		active[date] = ActiveDay{Date: date, DAU: live.Day, WAU: live.Week, MAU: live.Month}
	}

	var days []Day
	for day := first; day.Before(end); day = day.AddDate(0, 0, 1) {
		date := day.Format(DateLayout)
		total += signups[date]
		a := active[date]
		days = append(days, Day{
			Date: date, UsersTotal: total, NewUsers: signups[date],
			DAU: a.DAU, WAU: a.WAU, MAU: a.MAU,
		})
	}
	return days, nil
}

func parseDay(s string) (time.Time, error) {
	d, err := time.Parse(DateLayout, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %q is not YYYY-MM-DD", ErrBadRange, s)
	}
	return d, nil
}

// window is the [from, to) of the days UTC days ending with day.
func window(day time.Time, days int) (time.Time, time.Time) {
	return day.AddDate(0, 0, 1-days), day.AddDate(0, 0, 1)
}

func startOfDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
