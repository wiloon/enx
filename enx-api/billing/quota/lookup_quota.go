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
)

// ErrQuotaExceeded is returned when userID has already used up today's free
// dictionary lookups. Callers should map this to HTTP 429.
var ErrQuotaExceeded = errors.New("quota: daily dictionary lookup limit exceeded")

// CheckAndIncrementLookup checks userID's lookup count for today (UTC)
// against limit and, if under it, increments the count -- in one atomic
// statement: insert the day's first lookup, or bump an existing count but
// only while it's below limit. A rejected call touches nothing. No
// read-then-write window and no transaction, so concurrent lookups from the
// same user can neither overcount nor collide on the (user_id, date) key.
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

	res := sqlitex.DB.WithContext(ctx).Exec(
		`INSERT INTO dictionary_lookup_quota (user_id, date, count) VALUES (?, ?, 1)
		 ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 WHERE count < ?`,
		userID, date, limit,
	)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrQuotaExceeded
	}
	return nil
}
