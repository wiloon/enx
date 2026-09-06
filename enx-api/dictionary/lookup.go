package dictionary

import (
	"context"
	"errors"
	"net/http"
	"time"

	"enx-api/billing/quota"
	"enx-api/ecdict"
	"enx-api/enx"
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
// Subject to the free-tier daily quota (TASK-SPEC §4.2) unless userID
// belongs to an active subscriber.
func Lookup(ctx context.Context, english, userID string) (*enx.Dictionary, error) {
	if !ecdict.IsAvailable() {
		return nil, ErrEcdictUnavailable
	}

	// The quota is a usage cap on a near-zero-cost operation, not a paywall,
	// so its failure modes fail open (ADR-018 E2): a subscriber-check
	// hiccup must not 429 a paying user (#18), and a quota-store hiccup must
	// not hide a real definition behind "not found" (#17).
	subscriber, err := isActiveSubscriber(userID)
	if err != nil {
		logger.Warnf("dictionary: subscriber check failed for user %s, treating as subscriber: %v", userID, err)
		subscriber = true
	}

	if !subscriber {
		limit := viper.GetInt64("stripe.quota.dictionary-lookup-daily")
		if err := quota.CheckAndIncrementLookup(ctx, userID, limit, time.Now()); err != nil {
			if errors.Is(err, ErrQuotaExceeded) {
				return nil, ErrQuotaExceeded
			}
			logger.Warnf("dictionary: quota check failed for user %s, allowing lookup: %v", userID, err)
		}
	}

	return ecdict.Query(ctx, english), nil
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

// RespondQuotaExceeded writes the 429 response for a free user who's hit
// their daily dictionary lookup limit -- distinct from the 503 above, which
// means "the service itself is unavailable" (TASK-SPEC §4.2).
func RespondQuotaExceeded(c *gin.Context) {
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": "Daily dictionary lookup limit reached. Upgrade to enx Pro for unlimited lookups.",
	})
}
