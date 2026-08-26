package dictionary

import (
	"context"
	"errors"
	"net/http"
	"time"

	"enx-api/billing/quota"
	"enx-api/ecdict"
	"enx-api/enx"
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

	if !isActiveSubscriber(userID) {
		limit := viper.GetInt64("stripe.quota.dictionary-lookup-daily")
		if err := quota.CheckAndIncrementLookup(ctx, userID, limit, time.Now()); err != nil {
			return nil, err
		}
	}

	return ecdict.Query(ctx, english), nil
}

func isActiveSubscriber(userID string) bool {
	var count int64
	sqlitex.DB.Model(&sqlitex.Subscription{}).
		Where("user_id = ? AND status = ?", userID, "active").
		Count(&count)
	return count > 0
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
