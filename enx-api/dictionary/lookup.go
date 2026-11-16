package dictionary

import (
	"context"
	"errors"
	"time"

	"enx-api/config"
	"enx-api/utils/logger"
)

// ErrEcdictUnavailable is returned when ECDICT is not configured.
var ErrEcdictUnavailable = errors.New("ecdict unavailable")

// ErrQuotaExceeded is returned when a user has used up today's dictionary
// lookups. Callers map it to HTTP 429.
var ErrQuotaExceeded = errors.New("dictionary: daily lookup limit exceeded")

// LookupOutcome is the outcome column of a lookup event.
type LookupOutcome string

// OutcomeAllowed is the only outcome written since ADR-079 Decision 6: an
// over-quota lookup writes no event.
const OutcomeAllowed LookupOutcome = "allowed"

// LookupEvent is one lookup the user made (ADR-059 Decision 1, ADR-079
// Decision 6): who, when, and the caller's UTC offset at the time. Never
// which word or which page.
type LookupEvent struct {
	UserID          string
	At              time.Time
	TZOffsetMinutes int
	Outcome         LookupOutcome
}

// LookupEventStore is the lookup event log: the lookup_events table.
type LookupEventStore interface {
	Add(ctx context.Context, e LookupEvent) error
}

// Subscriptions says whether a user is on the subscribed quota tier.
type Subscriptions interface {
	IsActiveSubscriber(ctx context.Context, userID string) (bool, error)
}

// QuotaStore is the daily lookup quota's counter: the dictionary_quota_usage
// table, one row per user and UTC day.
type QuotaStore interface {
	// Charge adds n to userID's used count for day when used+n stays within
	// limit, the day's first charge included, and reports allowed. Otherwise
	// it adds n to the rejected count instead. The decision and the write are
	// atomic, so concurrent charges never take used past limit.
	Charge(ctx context.Context, userID string, day time.Time, n, limit int64) (allowed bool, err error)
}

// QuotaMeter is the production Meter: the daily lookup quota (ADR-029,
// ADR-079 Decision 5). It counts dictionary use per UTC day in its own
// counter, not in lookup events.
type QuotaMeter struct {
	store  QuotaStore
	subs   Subscriptions
	limits config.StripeQuota
	now    func() time.Time
}

func NewQuotaMeter(store QuotaStore, subs Subscriptions, limits config.StripeQuota, now func() time.Time) *QuotaMeter {
	return &QuotaMeter{store: store, subs: subs, limits: limits, now: now}
}

// Charge charges n against userID's quota for today (UTC): all n are
// allowed, or none are and it returns ErrQuotaExceeded.
//
// It fails open (ADR-029 E2, #17, #18): when the counter can't be written,
// it logs a warning and allows the charge. ErrQuotaExceeded is the only
// error returned.
func (m *QuotaMeter) Charge(ctx context.Context, userID string, n int) error {
	now := m.now().UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	allowed, err := m.store.Charge(ctx, userID, day, int64(n), m.limit(ctx, userID))
	if err != nil {
		logger.Warnf("dictionary: lookup quota charge failed for user %s, allowing %d: %v", userID, n, err)
		return nil
	}
	if !allowed {
		return ErrQuotaExceeded
	}
	return nil
}

// limit is userID's daily lookup ceiling. Both tiers have one (ADR-059
// Decision 6), and config validation keeps them positive.
func (m *QuotaMeter) limit(ctx context.Context, userID string) int64 {
	subscribed, err := m.subs.IsActiveSubscriber(ctx, userID)
	if err != nil {
		// #18: a DB blip must never downgrade a paying user into a 429, so
		// an unreadable subscription resolves to the highest tier.
		logger.Warnf("dictionary: subscriber check failed for user %s, using the subscribed limit: %v", userID, err)
		subscribed = true
	}
	if subscribed {
		return m.limits.DictionaryLookupDailySubscribed
	}
	return m.limits.DictionaryLookupDailyFree
}
