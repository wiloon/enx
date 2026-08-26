// Package quota enforces the free-tier daily dictionary lookup limit
// (ADR-009 Decision 6, TASK-SPEC §4.2). It knows nothing about
// subscriptions -- callers decide whether a user is exempt (an active
// subscriber) before calling CheckAndIncrementLookup at all.
package quota

import (
	"context"
	"errors"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// ErrQuotaExceeded is returned when userID has already used up today's free
// dictionary lookups. Callers should map this to HTTP 429.
var ErrQuotaExceeded = errors.New("quota: daily dictionary lookup limit exceeded")

// CheckAndIncrementLookup atomically checks userID's lookup count for
// today (UTC) against limit and, if under it, increments the count. The
// check and increment happen in one conditional UPDATE ("WHERE ... count <
// limit"), so concurrent lookups from the same user can't push the count
// past limit (same pattern as billing/credit's balance deductions).
//
// limit <= 0 means "unlimited" rather than "always blocked". This is the
// opposite failure direction from billing/credit's grant/cost functions:
// those fail closed on an unconfigured (0) value because the risk is
// silently shortchanging a paying customer or giving away free AI calls.
// Here, an unconfigured quota failing open just means free lookups stay
// uncapped a little longer -- annoying at worst, not a broken paywall, and
// the free daily lookup is meant to stay a generous "hook" (see
// w10n-config/enx/monetization.md), so defaulting to unlimited until a real
// number is set is the safer default.
func CheckAndIncrementLookup(ctx context.Context, userID string, limit int64, now time.Time) error {
	if limit <= 0 {
		return nil
	}

	date := now.UTC().Format("2006-01-02")

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row sqlitex.DictionaryLookupQuota
		err := tx.Where("user_id = ? AND date = ?", userID, date).First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&sqlitex.DictionaryLookupQuota{UserId: userID, Date: date, Count: 1}).Error
		}
		if err != nil {
			return err
		}
		if row.Count >= limit {
			return ErrQuotaExceeded
		}

		result := tx.Model(&sqlitex.DictionaryLookupQuota{}).
			Where("user_id = ? AND date = ? AND count < ?", userID, date, limit).
			UpdateColumn("count", gorm.Expr("count + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrQuotaExceeded
		}
		return nil
	})
}
