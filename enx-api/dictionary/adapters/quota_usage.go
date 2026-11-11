package adapters

import (
	"context"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

const utcDayLayout = "2006-01-02"

// QuotaUsage is the dictionary.QuotaStore backed by the
// dictionary_quota_usage table.
type QuotaUsage struct{}

// Charge runs in one write transaction (sqlitex opens them immediate), so
// the allow-or-reject decision of concurrent charges is serialized. The
// decision itself is a single conditional UPDATE.
func (QuotaUsage) Charge(ctx context.Context, userID string, day time.Time, n, limit int64) (bool, error) {
	utcDay := day.UTC().Format(utcDayLayout)
	allowed := false
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Exec(`INSERT INTO dictionary_quota_usage (user_id, utc_day, used, rejected)
			VALUES (?, ?, 0, 0) ON CONFLICT(user_id, utc_day) DO NOTHING`, userID, utcDay).Error
		if err != nil {
			return err
		}
		res := tx.Exec(`UPDATE dictionary_quota_usage SET used = used + ?
			WHERE user_id = ? AND utc_day = ? AND used + ? <= ?`, n, userID, utcDay, n, limit)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 1 {
			allowed = true
			return nil
		}
		return tx.Exec(`UPDATE dictionary_quota_usage SET rejected = rejected + ?
			WHERE user_id = ? AND utc_day = ?`, n, userID, utcDay).Error
	})
	if err != nil {
		return false, err
	}
	return allowed, nil
}

// DeleteOutsideRetention deletes the days that ended before now minus
// retentionDays, the lookup events' retention (ADR-079 Decision 5). The day
// the window starts in is kept. It returns how many rows it deleted.
func (QuotaUsage) DeleteOutsideRetention(ctx context.Context, now time.Time, retentionDays int) (int64, error) {
	firstKept := now.UTC().AddDate(0, 0, -retentionDays).Format(utcDayLayout)
	res := sqlitex.DB.WithContext(ctx).Where("utc_day < ?", firstKept).Delete(&sqlitex.DictionaryQuotaUsage{})
	return res.RowsAffected, res.Error
}
