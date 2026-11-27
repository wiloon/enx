package adapters

import (
	"context"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// AnonymousDeviceUsage is the dictionary.DeviceUsageStore backed by the
// anonymous_device_usage table (ADR-095 Decision 5).
type AnonymousDeviceUsage struct{}

// Take runs in one write transaction (sqlitex opens them immediate), so
// concurrent takes are serialized; the decision is a single conditional
// UPDATE, as in QuotaUsage.Charge.
func (AnonymousDeviceUsage) Take(ctx context.Context, deviceHash string, day time.Time, limit int64) (bool, error) {
	utcDay := day.UTC().Format(utcDayLayout)
	allowed := false
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Exec(`INSERT INTO anonymous_device_usage (device_hash, utc_day, used)
			VALUES (?, ?, 0) ON CONFLICT(device_hash, utc_day) DO NOTHING`, deviceHash, utcDay).Error
		if err != nil {
			return err
		}
		res := tx.Exec(`UPDATE anonymous_device_usage SET used = used + 1
			WHERE device_hash = ? AND utc_day = ? AND used < ?`, deviceHash, utcDay, limit)
		if res.Error != nil {
			return res.Error
		}
		allowed = res.RowsAffected == 1
		return nil
	})
	if err != nil {
		return false, err
	}
	return allowed, nil
}

// Rollup writes one anonymous_lookups_daily row per finished UTC day (before
// now's) that has device rows, then deletes those rows, in one transaction.
// A day already rolled up keeps its row: rows written for it later (a lookup
// straddling midnight) are deleted without being counted. It returns the
// number of days newly rolled up. Run hourly, it leaves no device row older
// than about a day and an hour, inside the 2 days the privacy policy promises.
func (AnonymousDeviceUsage) Rollup(ctx context.Context, now time.Time) (int64, error) {
	today := now.UTC().Format(utcDayLayout)
	var days int64
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec(`INSERT INTO anonymous_lookups_daily (utc_day, devices, lookups)
			SELECT utc_day, SUM(CASE WHEN used > 0 THEN 1 ELSE 0 END), SUM(used)
			FROM anonymous_device_usage WHERE utc_day < ? GROUP BY utc_day HAVING SUM(used) > 0
			ON CONFLICT(utc_day) DO NOTHING`, today)
		if res.Error != nil {
			return res.Error
		}
		days = res.RowsAffected
		return tx.Exec(`DELETE FROM anonymous_device_usage WHERE utc_day < ?`, today).Error
	})
	if err != nil {
		return 0, err
	}
	return days, nil
}
