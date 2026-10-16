package repo

import (
	"context"

	"enx-api/utils/sqlitex"
)

// AddLookupEvent inserts one lookup event (ADR-059 Decision 1).
func AddLookupEvent(ctx context.Context, e sqlitex.LookupEvent) error {
	return sqlitex.DB.WithContext(ctx).Create(&e).Error
}

// CountLookupEventsSince counts userID's lookup events at or after sinceMs
// (UTC Unix milliseconds), rejected ones included. It reads a range of the
// (user_id, at) index only.
func CountLookupEventsSince(ctx context.Context, userID string, sinceMs int64) (int64, error) {
	var n int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.LookupEvent{}).
		Where("user_id = ? AND at >= ?", userID, sinceMs).
		Count(&n).Error
	return n, err
}
