// Package quota counts dictionary lookups per user per UTC day. Counting is
// all it does: what a user's limit is, and whether they are over it, belong
// to the caller (dictionary.MeterLookup). Splitting the two is what lets the
// service ship with counting on and blocking off (ADR-029 Decision 2).
package quota

import (
	"context"
	"errors"
	"time"

	"enx-api/utils/sqlitex"
)

// ErrQuotaExceeded is returned when userID has already used up today's
// dictionary lookups. Callers should map this to HTTP 429.
var ErrQuotaExceeded = errors.New("quota: daily dictionary lookup limit exceeded")

// IncrementLookup records one lookup request for userID on now's UTC day and
// returns that day's running count, this request included.
//
// It counts unconditionally, including requests the caller is about to
// reject (ADR-029 Options C2): the overflow is the demand that the limit
// suppressed, which is exactly the signal needed to pick a limit. So the
// stored count may exceed any limit -- readers must not assume otherwise.
//
// The count is atomic in one statement, as before: no read-then-write
// window, so concurrent lookups from the same user can neither overcount nor
// collide on the (user_id, date) key.
//
// The day boundary is UTC and deliberately differs from ADR-028's
// daily_stats, which uses the user's local day -- a local boundary can be
// reset by changing the device clock, and this table is the adversarial one.
func IncrementLookup(ctx context.Context, userID string, now time.Time) (int64, error) {
	date := now.UTC().Format("2006-01-02")

	var count int64
	err := sqlitex.DB.WithContext(ctx).Raw(
		`INSERT INTO dictionary_lookup_quota (user_id, date, count) VALUES (?, ?, 1)
		 ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
		 RETURNING count`,
		userID, date,
	).Scan(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}
