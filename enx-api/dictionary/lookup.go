package dictionary

import (
	"context"
	"errors"
	"net/http"
	"time"

	"enx-api/config"
	"enx-api/ecdict"
	"enx-api/stats"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// ErrEcdictUnavailable is returned when ECDICT is not configured.
var ErrEcdictUnavailable = errors.New("ecdict unavailable")

// ErrQuotaExceeded is returned when a user has used up today's dictionary
// lookups. Callers map it to HTTP 429.
var ErrQuotaExceeded = errors.New("dictionary: daily lookup limit exceeded")

// LookupOutcome is what the daily quota decided for one lookup request.
type LookupOutcome string

const (
	OutcomeAllowed  LookupOutcome = "allowed"
	OutcomeRejected LookupOutcome = "rejected" // answered with a 429
)

// LookupEvent is one lookup request (ADR-059 Decision 1): who, when, the
// caller's UTC offset at the time, and the quota's verdict. Never which word
// or which page.
type LookupEvent struct {
	UserID          string
	At              time.Time
	TZOffsetMinutes int
	Outcome         LookupOutcome
}

// LookupEventStore is the lookup event log: the lookup_events table.
type LookupEventStore interface {
	// CountSince counts userID's events at or after since, rejected ones
	// included.
	CountSince(ctx context.Context, userID string, since time.Time) (int64, error)
	Add(ctx context.Context, e LookupEvent) error
}

// Subscriptions says whether a user is on the subscribed quota tier.
type Subscriptions interface {
	IsActiveSubscriber(ctx context.Context, userID string) (bool, error)
}

// QuotaMeter is the production Meter. Every charge writes one lookup event,
// and the daily quota is the count of the user's events since UTC midnight
// (ADR-059 Decision 2, ADR-029).
type QuotaMeter struct {
	events LookupEventStore
	subs   Subscriptions
	limits config.StripeQuota
	now    func() time.Time
}

func NewQuotaMeter(events LookupEventStore, subs Subscriptions, limits config.StripeQuota, now func() time.Time) *QuotaMeter {
	return &QuotaMeter{events: events, subs: subs, limits: limits, now: now}
}

// Charge counts userID's events today (UTC), decides this request's outcome
// from that count, and records the request as one event. Rejected requests
// are recorded and counted too (ADR-029 C2): the quota counts requests.
//
// Count and insert are two statements with no transaction, so two
// concurrent requests can both see a count under the limit and both be
// allowed. One or two lookups over is acceptable for a cap on a
// near-zero-cost operation, and it keeps the write lock off the COUNT.
//
// It fails open (ADR-029 E2, #17, #18): when the count can't be read, it
// logs a warning and allows the lookup. A failed event write is only
// logged; the outcome still follows the count, so a user who is over the
// limit gets ErrQuotaExceeded either way. That is the only error returned.
func (m *QuotaMeter) Charge(ctx context.Context, userID string) error {
	now := m.now().UTC()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	count, err := m.events.CountSince(ctx, userID, midnight)
	if err != nil {
		logger.Warnf("dictionary: lookup quota count failed for user %s, allowing lookup: %v", userID, err)
		return nil
	}
	outcome := OutcomeAllowed
	if count+1 > m.limit(ctx, userID) {
		outcome = OutcomeRejected
	}

	err = m.events.Add(ctx, LookupEvent{
		UserID:          userID,
		At:              now,
		TZOffsetMinutes: stats.OffsetFromContext(ctx),
		Outcome:         outcome,
	})
	if err != nil {
		// The count already answered: a lost event only makes the count one
		// short, it never lets an over-limit lookup through.
		logger.Warnf("dictionary: lookup event write failed for user %s (outcome %s): %v", userID, outcome, err)
	}
	if outcome == OutcomeRejected {
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

// RespondUnavailable writes the ADR-mandated 503 JSON response.
func RespondUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"message": ecdict.UnavailableMessage(),
	})
}

// RespondQuotaExceeded writes the 429 response for a user who has hit their
// daily dictionary lookup limit -- distinct from the 503 above, which means
// "the service itself is unavailable" (TASK-SPEC §4.2).
//
// A subscriber hitting their ceiling is not an upsell moment: that tier is
// set high enough that reaching it means the account is being misused, not
// that they should pay more (ADR-029 Decision 5).

func RespondQuotaExceededWithSubscriptions(c *gin.Context, userID string, subs Subscriptions) {
	message := "Daily dictionary lookup limit reached. Upgrade to Catglish Pro for a much higher daily limit."
	ctx := context.Background()
	if c.Request != nil {
		ctx = c.Request.Context()
	}
	subscribed, err := subs.IsActiveSubscriber(ctx, userID)
	if err == nil && subscribed {
		message = "Daily dictionary lookup limit reached. That is unusually high for a subscription -- please contact support."
	}
	// The code tells the clients this 429 from the request rate limit's
	// too_many_requests (ADR-060 Decision 4).
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"code":    "lookup_quota_exceeded",
		"message": message,
	})
}
