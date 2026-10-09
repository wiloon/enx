// Package metrics holds enx-api's Prometheus metrics (ADR-040) on a registry
// of its own, served on a separate listener. Labels are small enumerable
// sets only: never a user id, a word, a sentence or a raw URL path.
package metrics

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

// LookupSourceKey is the gin context key a word-lookup handler sets to the
// dictionary.Source that answered ("local", "ecdict", "miss"); the
// middleware then records the request in the lookup histogram.
const LookupSourceKey = "enx.lookup_source"

// unmatchedRoute labels requests that matched no route, so a scan of random
// paths cannot mint new series.
const unmatchedRoute = "unmatched"

// Metrics is the set of enx-api metrics and the registry they live on.
type Metrics struct {
	registry *prometheus.Registry

	httpRequests   *prometheus.CounterVec
	httpDuration   *prometheus.HistogramVec
	lookupDuration *prometheus.HistogramVec
	aiDuration     *prometheus.HistogramVec
	aiTokens       *prometheus.CounterVec
	clerkVerify    *prometheus.HistogramVec
	stripeWebhooks *prometheus.CounterVec
	sqliteBusy     *prometheus.CounterVec
	trialGrants    prometheus.Counter
}

// New builds the metrics on a fresh registry, with the Go runtime and
// process collectors.
func New() *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		httpRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "enx_http_requests_total",
			Help: "HTTP requests handled, by route template, method and status.",
		}, []string{"route", "method", "status"}),
		httpDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "enx_http_request_duration_seconds",
			Help:    "Time to handle an HTTP request, by route template and method.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30, 60},
		}, []string{"route", "method"}),
		lookupDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "enx_dictionary_lookup_duration_seconds",
			Help:    "Time to answer a word lookup, by the source that answered it.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5},
		}, []string{"source"}),
		aiDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "enx_ai_request_duration_seconds",
			Help:    "Time of one AI provider call, by provider, operation and outcome.",
			Buckets: []float64{.25, .5, 1, 2, 4, 8, 15, 30, 60},
		}, []string{"provider", "operation", "outcome"}),
		aiTokens: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "enx_ai_tokens_total",
			Help: "Tokens reported by AI providers, by provider, operation and direction.",
		}, []string{"provider", "operation", "direction"}),
		clerkVerify: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "enx_clerk_verify_duration_seconds",
			Help:    "Time to check a Clerk session token, by outcome. A JWKS refresh shows as a latency spike.",
			Buckets: []float64{.0005, .001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5},
		}, []string{"outcome"}),
		stripeWebhooks: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "enx_stripe_webhook_total",
			Help: "Stripe webhook deliveries, by event type and outcome.",
		}, []string{"event_type", "outcome"}),
		sqliteBusy: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "enx_sqlite_busy_total",
			Help: "SQL statements that failed because SQLite was busy or locked, by read/write.",
		}, []string{"op"}),
		trialGrants: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "enx_trial_grants_total",
			Help: "Sign-up trial credit grants made (ADR-048).",
		}),
	}
	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.httpRequests, m.httpDuration, m.lookupDuration, m.aiDuration, m.aiTokens,
		m.clerkVerify, m.stripeWebhooks, m.sqliteBusy, m.trialGrants,
	)
	return m
}

// Handler serves the registry in the Prometheus exposition format.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// Middleware times every request and counts it by route template, method and
// status. Register it before gin.Recovery so a panic is recorded as the 500
// Recovery writes. CORS preflights are not recorded.
func (m *Metrics) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		start := time.Now()
		defer func() {
			// Runs after an inner panic is recovered, and also records one
			// that nothing recovered before re-raising it.
			status := c.Writer.Status()
			if r := recover(); r != nil {
				status = http.StatusInternalServerError
				defer panic(r)
			}
			route := c.FullPath()
			if route == "" {
				route = unmatchedRoute
			}
			elapsed := time.Since(start).Seconds()
			m.httpRequests.WithLabelValues(route, c.Request.Method, strconv.Itoa(status)).Inc()
			m.httpDuration.WithLabelValues(route, c.Request.Method).Observe(elapsed)
			if source := c.GetString(LookupSourceKey); source != "" {
				m.lookupDuration.WithLabelValues(source).Observe(elapsed)
			}
		}()
		c.Next()
	}
}

// ObserveAI records one AI provider call: its duration, its outcome ("ok",
// "timeout" or "error") and the tokens the provider reported.
func (m *Metrics) ObserveAI(provider, operation string, start time.Time, err error, inputTokens, outputTokens int) {
	m.aiDuration.WithLabelValues(provider, operation, aiOutcome(err)).Observe(time.Since(start).Seconds())
	if inputTokens > 0 {
		m.aiTokens.WithLabelValues(provider, operation, "input").Add(float64(inputTokens))
	}
	if outputTokens > 0 {
		m.aiTokens.WithLabelValues(provider, operation, "output").Add(float64(outputTokens))
	}
}

func aiOutcome(err error) string {
	if err == nil {
		return "ok"
	}
	var timeout interface{ Timeout() bool }
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout()) {
		return "timeout"
	}
	return "error"
}

// ObserveAuth records one Clerk session-token check (middleware.ClerkAuth).
func (m *Metrics) ObserveAuth(outcome string, elapsed time.Duration) {
	m.clerkVerify.WithLabelValues(outcome).Observe(elapsed.Seconds())
}

// ObserveWebhook records one Stripe webhook delivery. eventType is already
// narrowed to the handled types (billing does that).
func (m *Metrics) ObserveWebhook(eventType, outcome string) {
	m.stripeWebhooks.WithLabelValues(eventType, outcome).Inc()
}

// ObserveTrialGrant records one sign-up trial grant, so an abnormal number
// of new accounts shows up on the dashboard (ADR-048 Decision 7).
func (m *Metrics) ObserveTrialGrant() {
	m.trialGrants.Inc()
}

// InstrumentDB counts statements on db that fail because SQLite is busy or
// locked -- the first thing to hurt as the single writer (ADR-031) gets
// busier.
func (m *Metrics) InstrumentDB(db *gorm.DB) error {
	cb := db.Callback()
	for _, reg := range []struct {
		name, op string
		register func(string, func(*gorm.DB)) error
	}{
		{"gorm:query", "read", cb.Query().After("gorm:query").Register},
		{"gorm:row", "read", cb.Row().After("gorm:row").Register},
		{"gorm:create", "write", cb.Create().After("gorm:create").Register},
		{"gorm:update", "write", cb.Update().After("gorm:update").Register},
		{"gorm:delete", "write", cb.Delete().After("gorm:delete").Register},
		{"gorm:raw", "raw", cb.Raw().After("gorm:raw").Register},
	} {
		op := reg.op
		if err := reg.register("enx:sqlite_busy", func(tx *gorm.DB) {
			if tx.Error != nil && isBusy(tx.Error) {
				m.sqliteBusy.WithLabelValues(op).Inc()
			}
		}); err != nil {
			return fmt.Errorf("register sqlite busy callback after %s: %w", reg.name, err)
		}
	}
	return nil
}

func isBusy(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "SQLITE_BUSY") || strings.Contains(msg, "SQLITE_LOCKED") ||
		strings.Contains(msg, "database is locked")
}
