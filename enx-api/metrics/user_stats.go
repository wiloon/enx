package metrics

import (
	"context"
	"sync"
	"time"

	"enx-api/userstats"
	"enx-api/utils/logger"

	"github.com/prometheus/client_golang/prometheus"
)

// userStatsTTL is how long one query's numbers serve scrapes, so a scrape
// does not hit SQLite every time (ADR-058 Decision 3).
const userStatsTTL = 5 * time.Minute

// queryTimeout bounds one query so a slow database cannot stall a scrape.
const queryTimeout = 10 * time.Second

// UserStatsSource is the current user numbers (userstats.Service).
type UserStatsSource interface {
	Current(ctx context.Context) (userstats.Snapshot, error)
}

// RegisterUserStats adds enx_users_total, enx_active_users{window} and
// enx_new_users{window} (ADR-058 Decision 3), read from src at scrape time.
func (m *Metrics) RegisterUserStats(src UserStatsSource, now func() time.Time) {
	m.registry.MustRegister(&userStatsCollector{src: src, now: now})
}

var (
	usersTotalDesc = prometheus.NewDesc("enx_users_total",
		"Users with a Clerk account.", nil, nil)
	activeUsersDesc = prometheus.NewDesc("enx_active_users",
		"Distinct users with a word lookup (a 429 included) in the last 1, 7 or 30 UTC days, today included.",
		[]string{"window"}, nil)
	newUsersDesc = prometheus.NewDesc("enx_new_users",
		"Users created in the last 1, 7 or 30 UTC days, today included.",
		[]string{"window"}, nil)
)

type userStatsCollector struct {
	src UserStatsSource
	now func() time.Time

	mu      sync.Mutex
	cached  userstats.Snapshot
	fetched time.Time
	valid   bool
}

func (c *userStatsCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- usersTotalDesc
	ch <- activeUsersDesc
	ch <- newUsersDesc
}

// Collect emits nothing when the query fails: an error from a collector
// would fail the whole scrape, and these gauges are not worth the rest.
func (c *userStatsCollector) Collect(ch chan<- prometheus.Metric) {
	snap, ok := c.snapshot()
	if !ok {
		return
	}
	ch <- prometheus.MustNewConstMetric(usersTotalDesc, prometheus.GaugeValue, float64(snap.UsersTotal))
	for _, w := range []struct {
		label         string
		active, fresh int64
	}{
		{"1d", snap.Active.Day, snap.New.Day},
		{"7d", snap.Active.Week, snap.New.Week},
		{"30d", snap.Active.Month, snap.New.Month},
	} {
		ch <- prometheus.MustNewConstMetric(activeUsersDesc, prometheus.GaugeValue, float64(w.active), w.label)
		ch <- prometheus.MustNewConstMetric(newUsersDesc, prometheus.GaugeValue, float64(w.fresh), w.label)
	}
}

func (c *userStatsCollector) snapshot() (userstats.Snapshot, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.valid && now.Sub(c.fetched) < userStatsTTL {
		return c.cached, true
	}
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	snap, err := c.src.Current(ctx)
	if err != nil {
		logger.Errorf("metrics: user stats query failed: %v", err)
		return userstats.Snapshot{}, false
	}
	c.cached, c.fetched, c.valid = snap, now, true
	return snap, true
}
