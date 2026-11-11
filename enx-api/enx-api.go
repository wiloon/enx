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
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
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

	go runReaderDocumentCleanup()
	go runStatsIngestLogCleanup(cfg.Stats.Ingest.LogTTL(), cfg.Stats.LookupEvents.RetentionDays, userStats)
	go runTrialExpiry()
	// Referrer rewards need Stripe to check each payment for a refund or
	// dispute; without it they stay pending until it is configured.
	if stripeClient != nil {
		go runReferralRewards(server.NewReferralService(cfg, stripeClient, m))
	}

	go serveMetrics(cfg.Metrics.Addr, m)
	router := application.Handler()

	port := cfg.Enx.Port
	listenAddress := fmt.Sprintf(":%d", port)
	srv := server.NewHTTPServer(listenAddress, router, cfg.SentenceTranslate.RequestTimeout)

	go func() {
		utils.WaitSignals()
		cancelApp()
	}()
	logger.Infof("enx api listening port: %v", port)
	if err := application.Serve(appCtx, srv); err != nil {
		cancelApp()
		logger.Errorf("failed to listen or shut down: %v", err)
		logger.Sync()
		os.Exit(1)
	}
	logger.Infof("listen end")
}

// runReaderDocumentCleanup periodically hard-deletes expired reader
// documents (ADR-022 Option A1). The 7-day retention is a promise to users,
// not just an internal detail: read paths (reader.ListDocuments,
// reader.GetDocument) already filter out expired rows on their own, but
// this is what actually removes them from disk. Runs once immediately so a
// restart doesn't leave stale rows sitting for up to an hour, then hourly.
func runReaderDocumentCleanup() {
	purge := func() {
		deleted, err := reader.PurgeExpired(context.Background(), time.Now())
		if err != nil {
			logger.Errorf("reader: purge expired documents failed: %v", err)
			return
		}
		if deleted > 0 {
			logger.Infof("reader: purged %d expired document(s)", deleted)
		}
	}

	purge()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		purge()
	}
}

// runStatsIngestLogCleanup runs runStatsJobs once on start, so a restart
// doesn't leave a backlog, then hourly, mirroring the reader cleanup.
func runStatsIngestLogCleanup(ttl time.Duration, lookupEventRetentionDays int, activeUsers *userstats.Service) {
	purge := func() {
		runStatsJobs(context.Background(), time.Now(), ttl, lookupEventRetentionDays, activeUsers)
	}

	purge()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		purge()
	}
}

// runStatsJobs deletes expired stats deduplication rows (ADR-028 Decision
// 5), runs the lookup event job, and deletes the daily lookup quota rows
// outside the lookup events' retention (ADR-079 Decision 5). daily_stats
// and active_users_daily are history and are never deleted. Every step is
// safe to rerun.
func runStatsJobs(ctx context.Context, now time.Time, ingestLogTTL time.Duration, lookupEventRetentionDays int, activeUsers *userstats.Service) {
	deleted, err := stats.PurgeIngestLog(ctx, now, ingestLogTTL)
	if err != nil {
		logger.Errorf("stats: purge ingest log failed: %v", err)
	} else if deleted > 0 {
		logger.Infof("stats: purged %d expired ingest-log row(s)", deleted)
	}

	runLookupEventJob(ctx, now, lookupEventRetentionDays, activeUsers)

	deleted, err = dictadapters.QuotaUsage{}.DeleteOutsideRetention(ctx, now, lookupEventRetentionDays)
	if err != nil {
		logger.Errorf("dictionary: lookup quota usage cleanup failed: %v", err)
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
		logger.Errorf("userstats: active users rollup failed, lookup events kept: %v", err)
		return
	} else if days > 0 {
		logger.Infof("userstats: rolled up active users for %d day(s)", days)
	}

	deleted, err := stats.RollupLookupEvents(ctx, now, retentionDays)
	if err != nil {
		logger.Errorf("stats: lookup event rollup failed: %v", err)
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
func runReferralRewards(svc *referral.Service) {
	settle := func() {
		run, err := svc.PayDueRewards(context.Background())
		if err != nil {
			logger.Errorf("referral: pay due rewards failed: %v", err)
			return
		}
		for _, err := range run.Errors {
			logger.Warnf("referral: reward left pending for the next run: %v", err)
		}
		if run.Rewarded > 0 || run.Forfeited > 0 {
			logger.Infof("referral: %d reward(s) paid, %d forfeited", run.Rewarded, run.Forfeited)
		}
	}

	settle()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		settle()
	}
}

// runTrialExpiry forfeits expired trials with credits left (ADR-063
// Decision 10), once on start and then hourly, so the ledger records an
// expiry within the hour even when the user never writes again. An account
// that fails is retried on the next run.
func runTrialExpiry() {
	sweep := func() {
		run, err := credit.ExpireTrials(context.Background())
		if err != nil {
			logger.Errorf("credit: expire trials failed: %v", err)
			return
		}
		for _, err := range run.Errors {
			logger.Warnf("credit: trial left for the next run: %v", err)
		}
		if run.Expired > 0 {
			logger.Infof("credit: %d expired trial(s) forfeited", run.Expired)
		}
	}

	sweep()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		sweep()
	}
}

// serveMetrics serves /metrics on its own listener (ADR-040): never the
// public port, so nginx and the ingress never expose it. addr defaults to
// 127.0.0.1:9091 (EC2, where only the local Alloy scrapes it); homelab sets
// METRICS_ADDR=0.0.0.0:9091 so the cluster's Prometheus can reach the pod.
// An empty addr turns it off.
func serveMetrics(addr string, m *metrics.Metrics) {
	if addr == "" {
		logger.Warn("metrics listener disabled (metrics.addr is empty)")
		return
	}
	mux := http.NewServeMux()
	mux.Handle("/metrics", m.Handler())
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	logger.Infof("metrics listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		// Losing metrics must not take the API down with it.
		logger.Errorf("metrics listener on %s stopped: %v", addr, err)
	}
}
