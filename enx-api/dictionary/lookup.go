package dictionary

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"enx-api/billing/quota"
	"enx-api/dictsample"
	"enx-api/ecdict"
	"enx-api/enx"
	"enx-api/stats"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// ErrEcdictUnavailable is returned when ECDICT is not configured.
var ErrEcdictUnavailable = errors.New("ecdict unavailable")

// ErrQuotaExceeded is quota.ErrQuotaExceeded, re-exported so callers only
// need to import this package (matches ErrEcdictUnavailable's pattern).
var ErrQuotaExceeded = quota.ErrQuotaExceeded

// Lookup queries ECDICT (with word forms). Callers are expected to have
// already checked the local words table themselves before calling this.
// Subject to the daily lookup quota for userID's tier (ADR-029).
func Lookup(ctx context.Context, english, userID string) (*enx.Dictionary, error) {
	if !ecdict.IsAvailable() {
		return nil, ErrEcdictUnavailable
	}
	if err := MeterLookup(ctx, userID); err != nil {
		return nil, err
	}
	dict := ecdict.Query(ctx, english)
	// ADR-030 Decision 0 ②: record whether ECDICT resolved this, so the
	// miss rate stops being a guess. Temporary, off by default, and the
	// `dictsample` package is meant to be deleted whole afterwards.
	if dict != nil {
		dictsample.Word(english, dictsample.SourceEcdict)
	} else {
		dictsample.Word(english, dictsample.SourceNone)
	}
	return dict, nil
}

// MeterLookup charges one dictionary lookup against the caller's daily quota
// (ADR-018 B2): every resolved lookup counts, whether it came from the local
// words cache or from ECDICT, so callers that serve a word from cache still
// call this.
//
// Everyone is metered; subscribers just get a much higher ceiling (ADR-029
// Decision 1). Counting and blocking are separate steps: the count always
// happens, the comparison only when a limit is configured, so the service
// can run with counting on and blocking off until there is enough usage data
// to pick real numbers.
//
// The quota is a usage cap on a near-zero-cost operation, not a paywall, so
// it fails open (E2): a quota-store hiccup logs a warning and returns nil
// (allow) -- a paying user is never 429'd by a DB blip (#18), and a real
// definition is never hidden behind "quota error" (#17). Only a genuine
// ErrQuotaExceeded is returned.
func MeterLookup(ctx context.Context, userID string) error {
	limit := resolveLookupLimit(userID)

	now := time.Now()
	count, err := quota.IncrementLookup(ctx, userID, now)
	if err != nil {
		logger.Warnf("dictionary: quota count failed for user %s, allowing lookup: %v", userID, err)
		return nil
	}
	if limit > 0 && count > limit {
		return ErrQuotaExceeded
	}

	// Also file this lookup under the user's own local day, for the learning
	// statistics (ADR-029 Decision 7a). This is the same event the quota
	// counter just recorded, deliberately counted twice under two different
	// definitions of "a day" and of "a lookup":
	//
	//   dictionary_lookup_quota — UTC day, counts REQUESTS (rejected ones
	//     too). Adversarial view: what is this account consuming?
	//   daily_stats            — the user's local day, counts SERVED
	//     lookups. Learning view: how much did I actually learn today?
	//
	// Their numbers are expected not to match (ADR-029 Decision 6). This one
	// is best-effort: statistics must never cost a user their definition.
	if err := stats.AddLookup(ctx, userID, stats.LocalDateFromContext(ctx, now), stats.OffsetFromContext(ctx)); err != nil {
		logger.Warnf("dictionary: stats lookup count failed for user %s: %v", userID, err)
	}
	return nil
}

// resolveLookupLimit returns userID's daily lookup ceiling. 0 means "count,
// but never block" -- the state the service launches in (ADR-029 Decision 4).
func resolveLookupLimit(userID string) int64 {
	subscribed, err := isActiveSubscriber(userID)
	if err != nil {
		// #18: a DB blip must never downgrade a paying user into a 429, so
		// an unreadable subscription resolves to the highest tier.
		logger.Warnf("dictionary: subscriber check failed for user %s, using the subscribed limit: %v", userID, err)
		subscribed = true
	}
	if subscribed {
		return viper.GetInt64("stripe.quota.dictionary-lookup-daily-subscribed")
	}
	return freeLookupLimit()
}

var legacyQuotaKeyWarning sync.Once

func freeLookupLimit() int64 {
	if limit := viper.GetInt64("stripe.quota.dictionary-lookup-daily-free"); limit > 0 {
		return limit
	}
	// Pre-ADR-029 single-tier key, honoured for one release.
	if legacy := viper.GetInt64("stripe.quota.dictionary-lookup-daily"); legacy > 0 {
		legacyQuotaKeyWarning.Do(func() {
			logger.Warnf("config: stripe.quota.dictionary-lookup-daily is deprecated, use stripe.quota.dictionary-lookup-daily-free")
		})
		return legacy
	}
	return 0
}

func isActiveSubscriber(userID string) (bool, error) {
	var count int64
	err := sqlitex.DB.Model(&sqlitex.Subscription{}).
		Where("user_id = ? AND status = ?", userID, "active").
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
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
func RespondQuotaExceeded(c *gin.Context, userID string) {
	message := "Daily dictionary lookup limit reached. Upgrade to Catglish Pro for a much higher daily limit."
	if subscribed, err := isActiveSubscriber(userID); err == nil && subscribed {
		message = "Daily dictionary lookup limit reached. That is unusually high for a subscription -- please contact support."
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": message,
	})
}
