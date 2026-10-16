package stats

import (
	"context"
	"time"

	"enx-api/utils/sqlitex"
)

// Word lookups in the statistics come from lookup_events (ADR-059 Decision
// 4): the user's last two local days live, because they can still change,
// and every older day from daily_stats.word_lookups, which
// RollupLookupEvents keeps up to date. Only allowed events count; a 429 is
// not a lookup the user made.

// localDayOfEvent is an event's local date: its UTC instant shifted by the
// offset the caller had at the time.
const localDayOfEvent = `date(at / 1000 + tz_offset_minutes * 60, 'unixepoch')`

// UTC offsets run from -12:00 to +14:00, so a local day's events lie between
// its UTC midnight minus 14 hours and its next UTC midnight plus 12 hours.
const (
	maxAheadOfUTC  = 14 * time.Hour
	maxBehindOfUTC = 12 * time.Hour
)

// eventWindow is the [from, to) range of at, in Unix milliseconds, that holds
// every event of the local days first..last.
func eventWindow(first, last time.Time) (from, to int64) {
	return first.Add(-maxAheadOfUTC).UnixMilli(), last.AddDate(0, 0, 1).Add(maxBehindOfUTC).UnixMilli()
}

// liveFrom is the first local day whose lookups are read live: yesterday.
func liveFrom(today string) string {
	d, err := time.Parse(DateLayout, today)
	if err != nil {
		return today
	}
	return d.AddDate(0, 0, -1).Format(DateLayout)
}

// liveLookups counts userID's allowed events per local day in [from, to].
func liveLookups(ctx context.Context, userID, from, to string) (map[string]int64, error) {
	first, err := time.Parse(DateLayout, from)
	if err != nil {
		return nil, err
	}
	last, err := time.Parse(DateLayout, to)
	if err != nil {
		return nil, err
	}
	atFrom, atTo := eventWindow(first, last)

	type row struct {
		Day   string
		Count int64
	}
	var rows []row
	err = sqlitex.DB.WithContext(ctx).Raw(
		`SELECT `+localDayOfEvent+` AS day, COUNT(*) AS count
		 FROM lookup_events
		 WHERE user_id = ? AND at >= ? AND at < ? AND outcome = 'allowed'
		 GROUP BY day
		 HAVING day >= ? AND day <= ?`,
		userID, atFrom, atTo, from, to,
	).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Day] = r.Count
	}
	return out, nil
}

// withLiveLookups replaces the rolled-up word lookups of the live days in
// [from, to] in t, which sumRange read from daily_stats, with live counts.
func withLiveLookups(ctx context.Context, userID, from, to, today string, t *Totals) error {
	start := max(from, liveFrom(today))
	if start > to {
		return nil
	}
	var rolledUp int64
	if err := sqlitex.DB.WithContext(ctx).
		Table("daily_stats").
		Select("COALESCE(SUM(word_lookups), 0)").
		Where("user_id = ? AND date >= ? AND date <= ?", userID, start, to).
		Scan(&rolledUp).Error; err != nil {
		return err
	}
	live, err := liveLookups(ctx, userID, start, to)
	if err != nil {
		return err
	}
	t.WordLookups -= rolledUp
	for _, n := range live {
		t.WordLookups += n
	}
	return nil
}

// RollupLookupEvents is the daily lookup-event job (ADR-059 Decision 4): it
// overwrites daily_stats.word_lookups with each local day's count of allowed
// events, then deletes the events older than retentionDays. It returns how
// many events it deleted.
//
// Overwriting, never adding, makes a rerun harmless, so the job can run
// every hour. Each run rolls up the local days from two days after the
// retention cutoff up to yesterday (UTC):
//
//   - Up to yesterday: wherever the user is, every day before their own
//     yesterday is then in daily_stats, and their last two days are read
//     live. A day not yet over for some time zone is simply rolled up again
//     on the next run.
//   - From two days past the cutoff: a day whose events have started to be
//     deleted is not rolled up again from the rest, so it keeps the count
//     it had while all its events were there.
func RollupLookupEvents(ctx context.Context, now time.Time, retentionDays int) (int64, error) {
	now = now.UTC()
	cutoff := now.AddDate(0, 0, -retentionDays)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	first := time.Date(cutoff.Year(), cutoff.Month(), cutoff.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 2)
	last := today.AddDate(0, 0, -1)

	if !first.After(last) {
		atFrom, atTo := eventWindow(first, last)
		err := sqlitex.DB.WithContext(ctx).Exec(
			`INSERT INTO daily_stats (user_id, date, utc_offset_minutes, word_lookups)
			 SELECT user_id, `+localDayOfEvent+` AS day, MAX(tz_offset_minutes), COUNT(*)
			 FROM lookup_events
			 WHERE at >= ? AND at < ? AND outcome = 'allowed'
			 GROUP BY user_id, day
			 HAVING day >= ? AND day <= ?
			 ON CONFLICT(user_id, date) DO UPDATE SET word_lookups = excluded.word_lookups`,
			atFrom, atTo, first.Format(DateLayout), last.Format(DateLayout),
		).Error
		if err != nil {
			return 0, err
		}
	}

	res := sqlitex.DB.WithContext(ctx).
		Where("at < ?", cutoff.UnixMilli()).
		Delete(&sqlitex.LookupEvent{})
	return res.RowsAffected, res.Error
}
