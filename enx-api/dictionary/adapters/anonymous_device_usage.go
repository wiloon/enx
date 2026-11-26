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
