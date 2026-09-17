package stats

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/middleware"
	"enx-api/utils/logger"
)

// TZOffsetHeader carries the caller's UTC offset in minutes (the negation of
// JavaScript's Date.getTimezoneOffset(), i.e. UTC+8 sends 480). Read on the
// dictionary lookup path so the server can file an L1 count under the user's
// own day (ADR-029 Decision 7a). Absent or unparseable means UTC.
const TZOffsetHeader = "X-Enx-Tz-Offset"

// maxOffsetMinutes bounds a plausible UTC offset (UTC-12:00 .. UTC+14:00).
const maxOffsetMinutes = 14 * 60
const minOffsetMinutes = -12 * 60

// OffsetFromRequest reads TZOffsetHeader, falling back to UTC.
func OffsetFromRequest(c *gin.Context) int {
	raw := c.GetHeader(TZOffsetHeader)
	if raw == "" {
		return 0
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < minOffsetMinutes || v > maxOffsetMinutes {
		return 0
	}
	return v
}

// LocalDateFor renders now in a fixed offset. Used by the lookup path, which
// has a header but no client-computed date.
func LocalDateFor(now time.Time, offsetMinutes int) string {
	return now.UTC().Add(time.Duration(offsetMinutes) * time.Minute).Format(DateLayout)
}

type ingestRequest struct {
	ClientEventID    string `json:"clientEventId"`
	LocalDate        string `json:"localDate"`
	UTCOffsetMinutes int    `json:"utcOffsetMinutes"`
	Delta            struct {
		WordsRead            int64 `json:"wordsRead"`
		ArticlesRead         int64 `json:"articlesRead"`
		WordLookups          int64 `json:"wordLookups"`
		NewWords             int64 `json:"newWords"`
		WordsMastered        int64 `json:"wordsMastered"`
		PhraseLookups        int64 `json:"phraseLookups"`
		SentenceTranslations int64 `json:"sentenceTranslations"`
		ContextLookups       int64 `json:"contextLookups"`
	} `json:"delta"`
}

// IngestHandler handles POST /api/stats/ingest.
//
// Not on the metered path: this endpoint looks up no words, calls no model
// and touches no credits, so it sits outside ADR-018's single metering seam,
// same as the admin (ADR-021) and feedback (ADR-026) endpoints.
func IngestHandler(c *gin.Context) {
	var req ingestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	applied, err := Ingest(c.Request.Context(), userID, Report{
		ClientEventID:    req.ClientEventID,
		LocalDate:        req.LocalDate,
		UTCOffsetMinutes: req.UTCOffsetMinutes,
		Delta: Delta{
			WordsRead:            req.Delta.WordsRead,
			ArticlesRead:         req.Delta.ArticlesRead,
			WordLookups:          req.Delta.WordLookups,
			NewWords:             req.Delta.NewWords,
			WordsMastered:        req.Delta.WordsMastered,
			PhraseLookups:        req.Delta.PhraseLookups,
			SentenceTranslations: req.Delta.SentenceTranslations,
			ContextLookups:       req.Delta.ContextLookups,
		},
	}, time.Now())
	if err != nil {
		if errors.Is(err, ErrInvalidDate) || errors.Is(err, ErrMissingEventID) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		logger.Errorf("stats: ingest failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not record statistics"})
		return
	}

	// A duplicate is a 200, not an error: it is the expected outcome of the
	// client retrying a report whose response it never saw. Telling it
	// "already counted" is how it learns to drop the item from its queue.
	c.JSON(http.StatusOK, gin.H{"success": true, "applied": applied})
}

// OverviewHandler handles GET /api/stats/overview?date=YYYY-MM-DD.
// The date is the caller's local day; without one the server uses the UTC
// day, which is only right for UTC users and is a fallback, not a default.
func OverviewHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	now := time.Now()

	date := c.Query("date")
	if date == "" {
		date = LocalDateFor(now, OffsetFromRequest(c))
	}

	overview, err := GetOverview(c.Request.Context(), userID, date, now)
	if err != nil {
		if errors.Is(err, ErrInvalidDate) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		logger.Errorf("stats: overview failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not load statistics"})
		return
	}
	c.JSON(http.StatusOK, overview)
}

// SeriesHandler handles GET /api/stats/series?period=&from=&to=.
func SeriesHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	now := time.Now()

	period, err := ParsePeriod(c.Query("period"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	to, err := parseDateParam(c.Query("to"), LocalDateFor(now, OffsetFromRequest(c)))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	from, err := parseDateParam(c.Query("from"), to.AddDate(0, 0, -29).Format(DateLayout))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	points, err := GetSeries(c.Request.Context(), userID, period, from, to)
	if err != nil {
		logger.Errorf("stats: series failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "could not load statistics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"period": string(period), "points": points})
}

// parseDateParam accepts any date for a series window -- unlike ingest, a
// far-past `from` is a legitimate request to see old history, not a broken
// clock, so only the format is checked.
func parseDateParam(raw, fallback string) (time.Time, error) {
	if raw == "" {
		raw = fallback
	}
	d, err := time.Parse(DateLayout, raw)
	if err != nil {
		return time.Time{}, ErrInvalidDate
	}
	return d, nil
}

// --- carrying the caller's timezone down to the lookup path ---

type ctxKey struct{}

// WithOffset stores a UTC offset (minutes) on ctx.
func WithOffset(ctx context.Context, offsetMinutes int) context.Context {
	return context.WithValue(ctx, ctxKey{}, offsetMinutes)
}

// OffsetFromContext reads the offset put there by TZOffsetMiddleware,
// defaulting to UTC when the caller sent no header.
func OffsetFromContext(ctx context.Context) int {
	if v, ok := ctx.Value(ctxKey{}).(int); ok {
		return v
	}
	return 0
}

// TZOffsetMiddleware copies TZOffsetHeader onto the request context so code
// far from the HTTP layer -- dictionary.MeterLookup, which sees only a
// context.Context -- can file a count under the caller's own day without
// every function in between growing a date parameter.
func TZOffsetMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request = c.Request.WithContext(WithOffset(c.Request.Context(), OffsetFromRequest(c)))
		c.Next()
	}
}

// LocalDateFromContext is the caller's current local date.
func LocalDateFromContext(ctx context.Context, now time.Time) string {
	return LocalDateFor(now, OffsetFromContext(ctx))
}
