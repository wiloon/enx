package main

import (
	"context"
	"enx-api/account"
	"enx-api/billing/credit"
	"enx-api/config"
	dictadapters "enx-api/dictionary/adapters"
	"enx-api/dictsample"
	"enx-api/ecdict"
	"enx-api/metrics"
	"enx-api/reader"
	"enx-api/referral"
	"enx-api/repo"
	"enx-api/server"
	"enx-api/stats"
	"enx-api/userstats"
	"enx-api/utils"
	"enx-api/utils/logger"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	// shutdownGrace bounds how long the process gives its long-lived workers
	// to stop once the API server stops, so a SIGTERM cannot leave the
	// process exiting with work in flight. It is one budget for the whole
	// drain: the metrics listener spends metricsShutdownGrace of it, and the
	// join that follows keeps the rest.
	shutdownGrace = 5 * time.Second

	// metricsShutdownGrace is the part of shutdownGrace the metrics listener
	// may spend draining. It is shorter than the join so a scrape that runs
	// to its own deadline cannot make the join report a false timeout.
	metricsShutdownGrace = 3 * time.Second
)

func main() {
	fmt.Println("enx-api start...")

	configFile := flag.String("c", "", "config file path (e.g., config-e2e.toml)")
	flag.Parse()
	// A config mistake stops the process here instead of falling back
	// silently (#45). The logger is not up yet: it needs log.level.
	cfg, err := config.Load(*configFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("devMode:", cfg.Enx.DevMode)

	// Console only (docker/k8s collect stdout). The level comes from
	// log.level / LOG_LEVEL, default info.
	logLevel := cfg.Log.Level
	logger.Init("CONSOLE", logLevel, "enx-api")
	if cfg.File != "" {
		logger.Infof("loaded config file: %s", cfg.File)
	}
	gin.SetMode(server.GinMode(logLevel))
	m := metrics.New()
	// A database that failed to open or migrate (e.g. the #211 users
	// rebuild) stops the process before any job, listener or backfill runs.
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()
	stripeClient := server.StripeClient(cfg)
	application, err := server.Initialize(appCtx, cfg, m, stripeClient)
	if err != nil {
		cancelApp()
		logger.Errorf("application initialisation failed: %v", err)
		logger.Sync()
		os.Exit(1)
	}

	backfillTrialGrants(cfg)

	ecdict.Init(cfg.Ecdict.DBPath)
	dictsample.SetEnabled(cfg.Ecdict.Sampling)

	// Users, new users and active users (ADR-058): the gauges read it live,
	// the hourly job rolls finished days up.
	userStats := userstats.NewService(repo.UserStats{}, time.Now)
	m.RegisterUserStats(userStats, time.Now)

	tasks := &backgroundTasks{}
	tasks.start("reader document cleanup", func() { runReaderDocumentCleanup(appCtx) })
	tasks.start("stats and lookup cleanup", func() {
		runStatsIngestLogCleanup(appCtx, cfg.Stats.Ingest.LogTTL(), cfg.Stats.LookupEvents.RetentionDays, userStats)
	})
	tasks.start("trial expiry", func() { runTrialExpiry(appCtx) })
	// Referrer rewards need Stripe to check each payment for a refund or
	// dispute; without it they stay pending until it is configured.
	if stripeClient != nil {
		tasks.start("referral rewards", func() { runReferralRewards(appCtx, server.NewReferralService(cfg, stripeClient, m)) })
	}

	tasks.start("metrics listener", func() { serveMetrics(appCtx, cfg.Metrics.Addr, m) })
	router := application.Handler()

	port := cfg.Enx.Port
	listenAddress := fmt.Sprintf(":%d", port)
	srv := server.NewHTTPServer(listenAddress, router, cfg.SentenceTranslate.RequestTimeout)

	go func() {
		utils.WaitSignals()
		cancelApp()
	}()
	logger.Infof("enx api listening port: %v", port)
	serveErr, drained := serveUntilStopped(cancelApp, shutdownGrace, tasks, func() error {
		return application.Serve(appCtx, srv)
	})
	if !drained {
		logger.Warnf("background shutdown timed out after %s; still running: %s",
			shutdownGrace, strings.Join(tasks.stillRunning(), ", "))
	}
	if err := serveErr; err != nil {
		logger.Errorf("failed to listen or shut down: %v", err)
		logger.Sync()
		os.Exit(1)
	}
	logger.Infof("listen end")
}

// serveUntilStopped runs serve until it returns (SIGTERM, or a listener
// error), then cancels cancel and joins the background workers within grace.
// The join is what makes shutdown graceful: without it main would return
// while in-flight jobs were still running. It reports serve's error and
// whether every worker stopped in time.
func serveUntilStopped(cancel context.CancelFunc, grace time.Duration, work *backgroundTasks, serve func() error) (error, bool) {
	serveErr := serve()
	cancel()
	return serveErr, work.wait(grace)
}

// runReaderDocumentCleanup periodically hard-deletes expired reader
// documents (ADR-022 Option A1). The 7-day retention is a promise to users,
// not just an internal detail: read paths (reader.ListDocuments,
// reader.GetDocument) already filter out expired rows on their own, but
// this is what actually removes them from disk. Runs once immediately so a
// restart doesn't leave stale rows sitting for up to an hour, then hourly.
func runReaderDocumentCleanup(ctx context.Context) {
	purge := func(ctx context.Context) {
		deleted, err := reader.PurgeExpired(ctx, time.Now())
		if err != nil {
			logJobFailure("reader: purge expired documents", err)
			return
		}
		if deleted > 0 {
			logger.Infof("reader: purged %d expired document(s)", deleted)
		}
	}

	runPeriodic(ctx, time.Hour, purge)
}

// runStatsIngestLogCleanup runs runStatsJobs once on start, so a restart
// doesn't leave a backlog, then hourly, mirroring the reader cleanup.
func runStatsIngestLogCleanup(ctx context.Context, ttl time.Duration, lookupEventRetentionDays int, activeUsers *userstats.Service) {
	purge := func(ctx context.Context) {
		runStatsJobs(ctx, time.Now(), ttl, lookupEventRetentionDays, activeUsers)
	}

	runPeriodic(ctx, time.Hour, purge)
}

// runStatsJobs deletes expired stats deduplication rows (ADR-028 Decision
// 5), runs the lookup event job, and deletes the daily lookup quota rows
// outside the lookup events' retention (ADR-079 Decision 5). daily_stats
// and active_users_daily are history and are never deleted. Every step is
// safe to rerun.
func runStatsJobs(ctx context.Context, now time.Time, ingestLogTTL time.Duration, lookupEventRetentionDays int, activeUsers *userstats.Service) {
	deleted, err := stats.PurgeIngestLog(ctx, now, ingestLogTTL)
	if err != nil {
		logJobFailure("stats: purge ingest log", err)
	} else if deleted > 0 {
		logger.Infof("stats: purged %d expired ingest-log row(s)", deleted)
	}

	runLookupEventJob(ctx, now, lookupEventRetentionDays, activeUsers)

	deleted, err = dictadapters.QuotaUsage{}.DeleteOutsideRetention(ctx, now, lookupEventRetentionDays)
	if err != nil {
		logJobFailure("dictionary: lookup quota usage cleanup", err)
	} else if deleted > 0 {
		logger.Infof("dictionary: deleted %d lookup quota usage row(s) past retention", deleted)
	}
}

// runLookupEventJob is the daily lookup-event job (ADR-059 Decision 4): it
// rolls finished UTC days up into active_users_daily, then rolls local days
// up into daily_stats.word_lookups and deletes the events past retention.
// A failed active-users rollup skips the deletion, so no event leaves before
// it has been counted.
func runLookupEventJob(ctx context.Context, now time.Time, retentionDays int, activeUsers *userstats.Service) {
	if days, err := activeUsers.Rollup(ctx, retentionDays); err != nil {
		logJobFailure("userstats: active users rollup, lookup events kept", err)
		return
	} else if days > 0 {
		logger.Infof("userstats: rolled up active users for %d day(s)", days)
	}

	deleted, err := stats.RollupLookupEvents(ctx, now, retentionDays)
	if err != nil {
		logJobFailure("stats: lookup event rollup", err)
	} else if deleted > 0 {
		logger.Infof("stats: deleted %d lookup event(s) past retention", deleted)
	}
}

// backfillTrialGrants records every existing user's email in trial_grants
// (ADR-062 Decision 3's migration), so an account from before the table
// existed cannot be deleted and signed up again for a second trial. It runs
// on every start: a record already there is kept, and a key set later still
// gets its backfill.
func backfillTrialGrants(cfg *config.Config) {
	h := account.NewEmailHMAC(cfg.Account.EmailHMACKey.Reveal())
	if !h.Configured() {
		logger.Warnf("account.email-hmac-key (ACCOUNT_EMAIL_HMAC_KEY) is not set: no sign-up trial or invitee bonus is granted until it is")
		return
	}
	added, err := repo.TrialGrants{Hash: h.Of}.Backfill(context.Background(), time.Now())
	if err != nil {
		logger.Errorf("trial grants backfill failed after %d record(s): %v", added, err)
		return
	}
	if added > 0 {
		logger.Infof("trial grants backfill: recorded %d existing email(s)", added)
	}
}

// runReferralRewards settles the referrer rewards that are due (ADR-051
// Decision 5). Mirrors the cleanups: once on start, then hourly; a row
// Stripe could not answer for is retried on the next run, and the ledger's
// idempotency key keeps reruns and parallel instances from paying twice.
func runReferralRewards(ctx context.Context, svc *referral.Service) {
	settle := func(ctx context.Context) {
		run, err := svc.PayDueRewards(ctx)
		if err != nil {
			logJobFailure("referral: pay due rewards", err)
			return
		}
		for _, err := range run.Errors {
			logger.Warnf("referral: reward left pending for the next run: %v", err)
		}
		if run.Rewarded > 0 || run.Forfeited > 0 {
			logger.Infof("referral: %d reward(s) paid, %d forfeited", run.Rewarded, run.Forfeited)
		}
	}

	runPeriodic(ctx, time.Hour, settle)
}

// runTrialExpiry forfeits expired trials with credits left (ADR-063
// Decision 10), once on start and then hourly, so the ledger records an
// expiry within the hour even when the user never writes again. An account
// that fails is retried on the next run.
func runTrialExpiry(ctx context.Context) {
	sweep := func(ctx context.Context) {
		run, err := credit.ExpireTrials(ctx)
		if err != nil {
			logJobFailure("credit: expire trials", err)
			return
		}
		for _, err := range run.Errors {
			logger.Warnf("credit: trial left for the next run: %v", err)
		}
		if run.Expired > 0 {
			logger.Infof("credit: %d expired trial(s) forfeited", run.Expired)
		}
	}

	runPeriodic(ctx, time.Hour, sweep)
}

// logJobFailure reports a periodic job's failure. A cancellation is the
// shutdown signal doing its job, not an error: logging it at Error level
// would make every normal SIGTERM look like a fault.
func logJobFailure(what string, err error) {
	if errors.Is(err, context.Canceled) {
		logger.Infof("%s: cancelled by shutdown", what)
		return
	}
	logger.Errorf("%s failed: %v", what, err)
}

// serveMetrics serves /metrics on its own listener (ADR-040): never the
// public port, so nginx and the ingress never expose it. addr defaults to
// 127.0.0.1:9091 (EC2, where only the local Alloy scrapes it); homelab sets
// METRICS_ADDR=0.0.0.0:9091 so the cluster's Prometheus can reach the pod.
// An empty addr turns it off. ctx cancels to Shutdown the listener gracefully.
func serveMetrics(ctx context.Context, addr string, m *metrics.Metrics) {
	if addr == "" {
		logger.Warn("metrics listener disabled (metrics.addr is empty)")
		return
	}
	mux := http.NewServeMux()
	mux.Handle("/metrics", m.Handler())
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Errorf("metrics listener failed to listen on %s: %v", addr, err)
		return
	}
	logger.Infof("metrics listening on %s", addr)
	serveMetricsServer(ctx, addr, srv, listener)
}

// serveMetricsServer serves srv on listener until ctx is cancelled, then
// shuts it down within metricsShutdownGrace and waits for the drain to
// finish, so an in-flight scrape is not cut off. Losing metrics must not take
// the API down with it, so errors are logged here, never returned.
func serveMetricsServer(ctx context.Context, addr string, srv *http.Server, listener net.Listener) {
	done := make(chan struct{})
	serverStopped := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), metricsShutdownGrace)
			defer cancel()
			if err := srv.Shutdown(shutdownCtx); err != nil {
				logger.Warnf("metrics listener %s shutdown: %v", addr, err)
			}
		case <-serverStopped:
		}
	}()
	if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Errorf("metrics listener %s stopped: %v", addr, err)
	}
	close(serverStopped)
	<-done
}

// runPeriodic runs work once immediately, then every interval until ctx is
// cancelled. work receives ctx so a job in flight stops with the process.
func runPeriodic(ctx context.Context, interval time.Duration, work func(context.Context)) {
	work(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			work(ctx)
		}
	}
}

// backgroundTasks joins the process's long-lived workers when it shuts down.
// The zero value is ready to use.
type backgroundTasks struct {
	wg      sync.WaitGroup
	mu      sync.Mutex
	running map[string]struct{}
}

// start runs work in its own goroutine, keeping name so a shutdown timeout
// can say which worker had not returned.
func (t *backgroundTasks) start(name string, work func()) {
	t.mu.Lock()
	if t.running == nil {
		t.running = make(map[string]struct{})
	}
	t.running[name] = struct{}{}
	t.mu.Unlock()
	t.wg.Go(func() {
		defer t.finish(name)
		work()
	})
}

func (t *backgroundTasks) finish(name string) {
	t.mu.Lock()
	delete(t.running, name)
	t.mu.Unlock()
}

// wait blocks up to timeout for every worker to return. A false result means
// the deadline expired with work still in flight. The goroutine it leaves
// waiting on wg is harmless: the process is exiting and will not reuse t.
func (t *backgroundTasks) wait(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() { t.wg.Wait(); close(done) }()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}

// stillRunning lists, sorted, the workers that had not returned yet.
func (t *backgroundTasks) stillRunning() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	names := make([]string, 0, len(t.running))
	for name := range t.running {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
