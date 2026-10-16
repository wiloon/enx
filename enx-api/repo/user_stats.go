package repo

import (
	"context"
	"database/sql"
	"time"

	"enx-api/userstats"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm/clause"
)

// UserStats is userstats.Store over users, lookup_events and
// active_users_daily (ADR-058, ADR-059 Decision 4).
//
// users.created_at is stored as text with the writing server's UTC offset,
// so it is compared through datetime(), which normalises it to UTC.
type UserStats struct{}

var _ userstats.Store = UserStats{}

const sqlDateTime = "2006-01-02 15:04:05"

// clerkUsers are the users that count: legacy accounts without a Clerk id
// do not (ADR-058 Decision 1).
const clerkUsers = "clerk_user_id IS NOT NULL AND clerk_user_id != ''"

func sqlTime(t time.Time) string { return t.UTC().Format(sqlDateTime) }

func (UserStats) UsersTotal(ctx context.Context, before time.Time) (int64, error) {
	var n int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.User{}).
		Where(clerkUsers+" AND datetime(created_at) < ?", sqlTime(before)).
		Count(&n).Error
	return n, err
}

func (UserStats) NewUsers(ctx context.Context, from, to time.Time) (int64, error) {
	var n int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.User{}).
		Where(clerkUsers+" AND datetime(created_at) >= ? AND datetime(created_at) < ?", sqlTime(from), sqlTime(to)).
		Count(&n).Error
	return n, err
}

func (UserStats) ActiveUsers(ctx context.Context, from, to time.Time) (int64, error) {
	var n int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.LookupEvent{}).
		Where("at >= ? AND at < ?", from.UnixMilli(), to.UnixMilli()).
		Distinct("user_id").
		Count(&n).Error
	return n, err
}

func (UserStats) SignupsPerDay(ctx context.Context, from, to time.Time) (map[string]int64, error) {
	var rows []struct {
		Day   string
		Count int64
	}
	err := sqlitex.DB.WithContext(ctx).Raw(
		`SELECT date(created_at) AS day, COUNT(*) AS count
		 FROM users
		 WHERE `+clerkUsers+` AND datetime(created_at) >= ? AND datetime(created_at) < ?
		 GROUP BY day`,
		sqlTime(from), sqlTime(to),
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

func (UserStats) FirstSignup(ctx context.Context) (time.Time, bool, error) {
	var first sql.NullString
	err := sqlitex.DB.WithContext(ctx).Raw(
		`SELECT MIN(datetime(created_at)) FROM users WHERE ` + clerkUsers,
	).Scan(&first).Error
	if err != nil || !first.Valid {
		return time.Time{}, false, err
	}
	t, err := time.Parse(sqlDateTime, first.String)
	if err != nil {
		return time.Time{}, false, err
	}
	return t, true, nil
}

func (UserStats) FirstEvent(ctx context.Context) (time.Time, bool, error) {
	var first sql.NullInt64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.LookupEvent{}).
		Select("MIN(at)").Scan(&first).Error
	if err != nil || !first.Valid {
		return time.Time{}, false, err
	}
	return time.UnixMilli(first.Int64).UTC(), true, nil
}

func (UserStats) ActiveDays(ctx context.Context, from, to string) ([]userstats.ActiveDay, error) {
	var rows []sqlitex.ActiveUsersDay
	err := sqlitex.DB.WithContext(ctx).
		Where("date >= ? AND date <= ?", from, to).
		Order("date").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]userstats.ActiveDay, len(rows))
	for i, r := range rows {
		out[i] = userstats.ActiveDay{Date: r.Date, DAU: r.DAU, WAU: r.WAU, MAU: r.MAU}
	}
	return out, nil
}

func (UserStats) SaveActiveDay(ctx context.Context, d userstats.ActiveDay) error {
	return sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{UpdateAll: true}).
		Create(&sqlitex.ActiveUsersDay{Date: d.Date, DAU: d.DAU, WAU: d.WAU, MAU: d.MAU}).Error
}
