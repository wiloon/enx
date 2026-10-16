package userstats

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/utils/logger"
)

// dailyCacheTTL is how long one (from, to) answer is served again.
const dailyCacheTTL = 5 * time.Minute

// DailySource is the per-day history (Service.Daily).
type DailySource interface {
	Daily(ctx context.Context, from, to string) ([]Day, error)
}

// DailyHandler serves GET /api/ops/user-stats/daily?from=&to= to Grafana's
// Infinity datasource (ADR-058 Decision 4). It is outside Clerk: the caller
// holds a static bearer token, OPS_STATS_TOKEN. Without one configured the
// endpoint answers 404, as if it did not exist. It returns site-wide counts
// only, never a user id or email.
type DailyHandler struct {
	src       DailySource
	tokenHash [sha256.Size]byte
	enabled   bool
	now       func() time.Time

	mu    sync.Mutex
	cache map[string]cachedDays
}

type cachedDays struct {
	days []Day
	at   time.Time
}

func NewDailyHandler(src DailySource, token string, now func() time.Time) *DailyHandler {
	return &DailyHandler{
		src:       src,
		tokenHash: sha256.Sum256([]byte(token)),
		enabled:   token != "",
		now:       now,
		cache:     map[string]cachedDays{},
	}
}

func (h *DailyHandler) Serve(c *gin.Context) {
	if !h.enabled {
		c.Status(http.StatusNotFound)
		return
	}
	if !h.authorized(c.GetHeader("Authorization")) {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "invalid or missing token"})
		return
	}

	from, to := c.Query("from"), c.Query("to")
	days, err := h.daily(c.Request.Context(), from, to)
	if err != nil {
		if errors.Is(err, ErrBadRange) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		logger.Errorf("userstats: daily %s..%s failed: %v", from, to, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not load user statistics"})
		return
	}
	if days == nil {
		days = []Day{}
	}
	c.JSON(http.StatusOK, days)
}

// authorized compares hashes, so the comparison takes the same time whatever
// the presented token's length.
func (h *DailyHandler) authorized(header string) bool {
	presented, ok := strings.CutPrefix(header, "Bearer ")
	if !ok {
		return false
	}
	sum := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(sum[:], h.tokenHash[:]) == 1
}

func (h *DailyHandler) daily(ctx context.Context, from, to string) ([]Day, error) {
	key := from + "|" + to
	now := h.now()
	h.mu.Lock()
	if hit, ok := h.cache[key]; ok && now.Sub(hit.at) < dailyCacheTTL {
		h.mu.Unlock()
		return hit.days, nil
	}
	h.mu.Unlock()

	days, err := h.src.Daily(ctx, from, to)
	if err != nil {
		return nil, err
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for k, v := range h.cache {
		if now.Sub(v.at) >= dailyCacheTTL {
			delete(h.cache, k)
		}
	}
	h.cache[key] = cachedDays{days: days, at: now}
	return days, nil
}
