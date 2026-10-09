package main

import (
	"context"
	"enx-api/ailimit"
	"enx-api/aitranslate"
	"enx-api/aitranslate/worddef"
	"enx-api/billing"
	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/dictionary/adapters"
	"enx-api/ecdict"
	"enx-api/entitlement"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/enx"
	"enx-api/handlers"
	"enx-api/metrics"
	"enx-api/middleware"
	"enx-api/pagereport"
	"enx-api/paragraph"
	"enx-api/preferences"
	prefadapters "enx-api/preferences/adapters"
	"enx-api/reader"
	"enx-api/repo"
	"enx-api/savedpage"
	"enx-api/stats"
	"enx-api/translate"
	"enx-api/utils"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	wordCount "enx-api/word"
	"enx-api/wordlist"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
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
	utils.ViperInit()
	fmt.Println("devMode:", cfg.Enx.DevMode)

	// Console only (docker/k8s collect stdout). The level comes from
	// log.level / LOG_LEVEL, default info.
	logLevel := cfg.Log.Level
	logger.Init("CONSOLE", logLevel, "enx-api")
	if cfg.File != "" {
		logger.Infof("loaded config file: %s", cfg.File)
	}
	gin.SetMode(ginMode(logLevel))
	m := metrics.New()
	sqlitex.InitWithLogLevel(logLevel)
	if err := m.InstrumentDB(sqlitex.DB); err != nil {
		// Losing the busy counter must not stop the API.
		logger.Errorf("metrics: sqlite instrumentation: %v", err)
	}

	ecdict.Init(cfg.Ecdict.DBPath)

	go runReaderDocumentCleanup()
	go runStatsIngestLogCleanup()
	go runPageReportCleanup()

	go serveMetrics(cfg.Metrics.Addr, m)
	router := setupRouter(cfg, m)

	port := cfg.Enx.Port
	listenAddress := fmt.Sprintf(":%d", port)
	srv := newServer(listenAddress, router, cfg.SentenceTranslate.RequestTimeout)

	idleConnectionsClosed := make(chan struct{})
	go func() {
		utils.WaitSignals()
		// Bounded, and deliberately bounded at the same ceiling as a single
		// request: Shutdown waits for in-flight requests to finish, so a
		// grace period shorter than WriteTimeout would abort billed AI calls
		// on every deploy -- the same failure mode newServer exists to
		// prevent. context.Background() had the opposite problem: one stuck
		// connection kept the process alive forever.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), srv.WriteTimeout+shutdownGraceMargin)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Errorf("http server shutdown: %v", err)
		}
		close(idleConnectionsClosed)
	}()

	logger.Infof("enx api listening port: %v", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Errorf("failed to listen, %v", err)
		logger.Error("server failed to start, exiting...")
		os.Exit(1)
	}
	logger.Infof("listen end")
	<-idleConnectionsClosed
}

const (
	// writeTimeoutHeadroom is what the server allows a metered request on top
	// of the provider call itself: Clerk JWT verification (which can make a
	// network round trip when the JWKS cache refreshes), the ADR-014 balance
	// precheck, the ledger Settle write, JSON encoding, and pushing the
	// response to a client that may be on a slow mobile link. All of that is
	// normally milliseconds; 15s is sized so it is never the thing that kills
	// a legitimate request, while still keeping the total bounded (75s at the
	// 60s default) well under IdleTimeout.
	writeTimeoutHeadroom = 15 * time.Second

	// minWriteTimeout floors the derived value so a deliberately tiny
	// provider timeout (a test or a misconfigured env var setting "1s")
	// cannot shrink the server's own budget below what the non-AI routes
	// need. It is the historical 30s, which was always fine for those.
	minWriteTimeout = 30 * time.Second

	// shutdownGraceMargin is the slack Shutdown gets beyond one request's
	// ceiling, so a request that started just before SIGTERM can still
	// finish and flush instead of being cut off mid-response.
	shutdownGraceMargin = 5 * time.Second
)

// newServer builds the HTTP server. Extracted from main() so the timeout
// coupling below is reachable from a test.
//
// WriteTimeout is derived from the AI provider's request timeout
// (sentence-translate.request-timeout) instead of being its own constant because the two are not independent: Go's WriteTimeout starts
// when the request header is read and covers body read, handler execution and
// response write, so a WriteTimeout below the provider timeout means the
// server tears the connection down while its own handler is still waiting on
// the model. On /translate/sentence and /rephrase that is worse than a
// dropped request -- they are token-billed (ADR-012/ADR-014), the handler
// keeps running past the write deadline, so the provider call completes and
// Settle charges the user for a response that never reached them.
//
// That is not hypothetical: WriteTimeout sat at a hard-coded 30s (added when
// the provider timeout was 10s) while the provider default was later raised
// to 60s for MiniMax's M-series "thinking" models, silently putting every
// 30-60s translation in the billed-but-undelivered window. Deriving it means
// raising SENTENCE_TRANSLATE_REQUEST_TIMEOUT can no longer reopen that gap.
func newServer(addr string, handler http.Handler, providerTimeout time.Duration) *http.Server {
	writeTimeout := providerTimeout + writeTimeoutHeadroom
	if writeTimeout < minWriteTimeout {
		writeTimeout = minWriteTimeout
	}
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       120 * time.Second,
	}
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

// runStatsIngestLogCleanup periodically deletes expired stats deduplication
// rows (ADR-028 Decision 5). Only the dedup log is purged -- daily_stats is
// the user's own history and is never deleted. Mirrors the reader cleanup:
// once on start so a restart doesn't leave a backlog, then hourly.
func runStatsIngestLogCleanup() {
	purge := func() {
		deleted, err := stats.PurgeIngestLog(context.Background(), time.Now())
		if err != nil {
			logger.Errorf("stats: purge ingest log failed: %v", err)
			return
		}
		if deleted > 0 {
			logger.Infof("stats: purged %d expired ingest-log row(s)", deleted)
		}
	}

	purge()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		purge()
	}
}

// runPageReportCleanup periodically hard-deletes page reports past their
// retention period (ADR-010 Decision 8). Mirrors the other cleanups: once on
// start so a restart doesn't leave a backlog, then hourly.
func runPageReportCleanup() {
	purge := func() {
		deleted, err := pagereport.PurgeExpired(context.Background(), time.Now())
		if err != nil {
			logger.Errorf("pagereport: purge failed: %v", err)
			return
		}
		if deleted > 0 {
			logger.Infof("pagereport: purged %d expired report(s)", deleted)
		}
	}

	purge()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		purge()
	}
}

// ginMode ties gin's mode to the log level: debug keeps gin's route dump and
// warnings, anything else (production defaults to info) runs release.
func ginMode(logLevel string) string {
	if strings.EqualFold(strings.TrimSpace(logLevel), "debug") {
		return gin.DebugMode
	}
	return gin.ReleaseMode
}

func setupRouter(cfg *config.Config, m *metrics.Metrics) *gin.Engine {
	router := gin.New()

	// Metrics and the request log wrap Recovery, so a recovered panic is
	// recorded as the 500 Recovery writes (ADR-040).
	router.Use(m.Middleware())
	// One structured line per request (route template, status, duration,
	// user) instead of free-text request logging.
	router.Use(middleware.RequestLog(logger.Infow))
	router.Use(gin.Recovery())

	// Custom CORS middleware to support chrome-extension origins
	router.Use(func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		// List of allowed origins
		allowedOrigins := []string{
			"http://localhost:3000",
			"https://enx.wiloon.lab",
			"https://enx.wiloon.com",
		}

		// Check if origin is allowed or is a chrome extension
		isAllowed := false
		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				isAllowed = true
				break
			}
		}

		// Also allow browser extensions. strings.HasPrefix, not a slice: any
		// Origin shorter than the slice bound panicked here, and browsers do
		// send short ones (literal "null" for sandboxed iframes and file://
		// documents). The "://" is part of the prefix so the match can't be
		// satisfied by an origin that merely starts with the scheme name.
		if !isAllowed && (strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "moz-extension://")) {
			isAllowed = true
		}

		if isAllowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, QUERY, OPTIONS, PUT, DELETE")
			// X-Enx-Tz-Offset is read by stats.TZOffsetMiddleware (ADR-029
			// Decision 7a); without it here, preflight rejects the header and
			// the whole cross-origin request fails once a client starts sending it.
			c.Header("Access-Control-Allow-Headers", "Origin, Authorization, X-Session-ID, X-User-ID, Content-Type, Cookie, X-Enx-Tz-Offset")
			c.Header("Access-Control-Expose-Headers", "Content-Length")
			c.Header("Access-Control-Max-Age", "43200") // 12 hours
		}

		// Handle preflight requests
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	router.GET("/ping", handlers.Ping)

	// Version information API - no authentication required
	router.GET("/version", handlers.GetVersion)
	router.GET("/api/version", handlers.GetVersionSimple)

	clerkAuth := middleware.ClerkAuth(middleware.ClerkConfigFromViper(), m)

	// Word lookup (ADR-018): the dictionary domain service over the words
	// table and ECDICT, plus the per-user review log.
	// Word states for a page (paragraph-init): one query per paragraph.
	paragraphHandler := paragraph.NewHandler(enx.NewTextWords(enx.RepoWordStates{}))

	// One entitlement judgement (ADR-045 Decision 14) for the lookup, which
	// hides AI-made definitions from users who can't use AI, and for the
	// preferences, whose editability follows the same rule.
	entitlements := entitlement.NewService(entadapters.Billing{})

	// Sign-up trial (ADR-048): every new account gets the trial credits, and
	// users whose AI access comes from the trial alone are held to its call
	// rate on every AI feature.
	enx.SetNewUserHook(billing.TrialGrant{
		Amount:  cfg.Credits.Trial.Amount,
		TTL:     time.Duration(cfg.Credits.Trial.TTLDays) * 24 * time.Hour,
		Observe: m.ObserveTrialGrant,
	})
	trialGate := ailimit.NewTrialGate(entitlements, ailimit.NewMemoryLimiter(ailimit.Limits{
		CallsPerMinute: cfg.Credits.Trial.CallsPerMinute,
		CallsPerDay:    cfg.Credits.Trial.CallsPerDay,
	}, nil))

	dictionaryService := dictionary.NewService(adapters.WordsTable{}, adapters.Ecdict{}, dictionary.QuotaMeter{}, entitlements)
	preferencesService := preferences.NewService(prefadapters.Table{}, entitlements)

	// The AI word fallback (ADR-045) is a second request after a lookup
	// missed. The policy decides what that miss offers each user; the service
	// itself is switched on below, once the AI provider exists.
	lookupHandler := translate.NewHandler(dictionaryService, repo.ReviewLog{}).WithAI(
		dictionaryService,
		adapters.AIPolicy{Service: dictionaryService, Entitlements: entitlements, Preferences: preferencesService},
	)

	// Sentence translation is an optional feature: if sentence-translate.provider
	// is unset, it stays disabled (same "unconfigured but not fatal" pattern as
	// ECDICT when ecdict.db_path is empty) and the endpoint responds 502. But if
	// a provider WAS explicitly configured and its credentials/config are
	// missing, that's a deliberate misconfiguration and must fail fast rather
	// than silently serving a broken endpoint (see
	// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §4.4).
	sentenceTranslator, sentenceTranslateErr := aitranslate.New(context.Background(), cfg.SentenceTranslate)
	if sentenceTranslateErr != nil {
		if provider := cfg.SentenceTranslate.Provider; provider != "" {
			logger.Errorf("sentence-translate.provider=%q is configured but failed to initialize: %v", provider, sentenceTranslateErr)
			os.Exit(1)
		}
		logger.Warnf("sentence translation disabled: %v", sentenceTranslateErr)
		sentenceTranslator = nil
	} else {
		sentenceTranslator = aitranslate.Instrument(sentenceTranslator, cfg.SentenceTranslate.Provider, m)
	}

	// The AI word fallback (ADR-045) rides on the same provider, but only a
	// provider that implements DefineWord can serve it; others leave it off,
	// like any optional feature that is not configured.
	if sentenceTranslator != nil {
		if definer, ok := aitranslate.AsWordDefiner(sentenceTranslator); ok {
			dictionaryService.EnableAI(
				adapters.AIDefiner{Definer: definer},
				adapters.TokenBilling{
					Pricing: tokenPricing(cfg.Stripe.Costs.DefineWord),
					Feature: "lookup_word_ai",
				},
				ailimit.NewMemoryLimiter(ailimit.Limits{
					CallsPerMinute:    cfg.AIWord.CallsPerMinute,
					CallsPerDay:       cfg.AIWord.CallsPerDay,
					CacheWritesPerDay: cfg.AIWord.CacheWritesPerDay,
				}, nil),
				dictionary.AIConfig{
					MinQuality:    cfg.AIWord.MinQuality,
					PromptVersion: worddef.PromptVersion,
					CallTimeout:   cfg.AIWord.CallTimeout,
				},
			)
			dictionaryService.LimitTrial(trialGate)
			if !dictionaryService.AIConfigured() {
				logger.Warnf("AI word lookup is off: stripe.costs.define-word has no price")
			}
		} else {
			logger.Warnf("AI word lookup is off: provider %q does not implement DefineWord", cfg.SentenceTranslate.Provider)
		}
	}

	sentenceHandler := aitranslate.NewHandler(
		sentenceTranslator,
		aitranslate.DefaultTokenLedger,
		tokenPricing(cfg.Stripe.Costs.Translate),
	).WithTrialGate(trialGate)

	// Rephrase (ADR-012) reuses the same provider as sentence translation,
	// but the provider must also implement rephrase support. Same
	// "unconfigured is not fatal, misconfigured is" contract as above.
	rephraser, rephraseErr := aitranslate.NewRephraser(context.Background(), cfg.SentenceTranslate)
	if rephraseErr != nil {
		if provider := cfg.SentenceTranslate.Provider; provider != "" {
			logger.Errorf("sentence-translate.provider=%q is configured but rephrase failed to initialize: %v", provider, rephraseErr)
			os.Exit(1)
		}
		logger.Warnf("rephrase disabled: %v", rephraseErr)
		rephraser = nil
	} else {
		rephraser = aitranslate.InstrumentRephraser(rephraser, cfg.SentenceTranslate.Provider, m)
	}
	rephraseHandler := aitranslate.NewRephraseHandler(
		rephraser,
		aitranslate.DefaultTokenLedger,
		tokenPricing(cfg.Stripe.Costs.Rephrase),
	).WithTrialGate(trialGate)

	// Stripe billing is likewise optional: without STRIPE_SECRET_KEY (a local
	// dev box, or a deployment that hasn't set the secret yet), billing
	// endpoints stay disabled (503) rather than the server failing to start.
	// See docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md.
	stripeClient, stripeErr := billingstripe.New(cfg.Stripe.SecretKey)
	if stripeErr != nil {
		logger.Warnf("billing disabled: %v", stripeErr)
		stripeClient = nil
	}
	billingHandler := billing.NewHandler(stripeClient, cfg.App.FrontendBaseURL, cfg.Stripe.WebhookSecret, m)

	// Authenticated APIs (Clerk session JWT). enx-chrome and enx-ui call only
	// these /api routes; nothing is registered twice at the root.
	apiGroup := router.Group("/api")
	apiGroup.Use(clerkAuth)
	// Carries X-Enx-Tz-Offset down to dictionary.MeterLookup so a lookup is
	// counted under the caller's own day (ADR-029 Decision 7a).
	apiGroup.Use(stats.TZOffsetMiddleware())
	{
		// get words query count by paragraph
		// ADR-041: QUERY is the default, POST the fallback; GET is
		// deprecated and kept only for older extension builds.
		apiGroup.Handle("QUERY", "/paragraph-init", paragraphHandler.ParagraphInitBody)
		apiGroup.POST("/paragraph-init", paragraphHandler.ParagraphInitBody)
		apiGroup.GET("/paragraph-init", paragraphHandler.ParagraphInit)

		// translate
		apiGroup.GET("/translate", lookupHandler.Translate)
		apiGroup.GET("/word/:word", lookupHandler.TranslateByWord)
		apiGroup.POST("/dictionary/ai-word", lookupHandler.AIWord)
		apiGroup.POST("/translate/sentence", sentenceHandler.TranslateSentence)
		apiGroup.POST("/translate/word-in-context", sentenceHandler.TranslateWordInContext)
		apiGroup.POST("/translate/sentence-with-word", sentenceHandler.TranslateSentenceWithWord)
		apiGroup.POST("/rephrase", rephraseHandler.Rephrase)
		apiGroup.GET("/load-count", wordCount.LoadCount)
		apiGroup.POST("/mark", handlers.MarkWord)
	}

	// /api/me — requires authentication (Clerk session JWT)
	apiGroup.GET("/me", handlers.GetMe)

	// Server-side user preferences (ADR-044): the AI word fallback switch and
	// its one-time notice. Defaults and editability follow the user's payment
	// state (ADR-045 Decision 14).
	preferencesHandler := handlers.NewPreferencesHandler(preferencesService)
	apiGroup.GET("/me/preferences", preferencesHandler.Get)
	apiGroup.PUT("/me/preferences", preferencesHandler.Update)

	// The user's word list: every word they looked up in an article,
	// including the ones marked known. Read-only, not on the metered path.
	apiGroup.GET("/me/words", wordlist.ListHandler)

	// Billing (Stripe) — requires authentication (Clerk session JWT).
	apiGroup.POST("/billing/checkout/subscription", billingHandler.CheckoutSubscription)
	apiGroup.POST("/billing/checkout/topup", billingHandler.CheckoutTopup)
	apiGroup.POST("/billing/portal", billingHandler.Portal)
	apiGroup.GET("/billing/me", billingHandler.Me)

	// Reader (ADR-022): enx-ui's pasted-text documents. 20,000-char limit and
	// 50-document-per-user cap are enforced in reader.CreateDocument; 7-day
	// TTL is enforced by runReaderDocumentCleanup plus the expiry filter
	// baked into reader.ListDocuments / reader.GetDocument.
	apiGroup.POST("/reader/documents", reader.CreateDocumentHandler)
	apiGroup.GET("/reader/documents", reader.ListDocumentsHandler)
	apiGroup.GET("/reader/documents/:id", reader.GetDocumentHandler)
	apiGroup.PUT("/reader/documents/:id", reader.UpdateDocumentHandler)
	apiGroup.DELETE("/reader/documents/:id", reader.DeleteDocumentHandler)

	// Reading statistics (ADR-028). Deliberately NOT on the metered path:
	// these look up no words, call no model and touch no credits, so they
	// sit outside ADR-018's single metering seam (same as admin/ADR-021).
	apiGroup.POST("/stats/ingest", stats.IngestHandler)
	apiGroup.GET("/stats/overview", stats.OverviewHandler)
	apiGroup.GET("/stats/series", stats.SeriesHandler)

	// User-confirmed "this page didn't work" reports (ADR-010 Decision 8).
	// The one endpoint that stores a (sanitized) URL, so the extension only
	// calls it after the user clicks to confirm. Not on the metered path.
	apiGroup.POST("/page-reports", pagereport.SubmitHandler)

	// Pages the user chose to save (ADR-032): URL + title only, readable and
	// editable by that user alone -- there is deliberately no admin route.
	// Not on the metered path.
	apiGroup.POST("/saved-pages", savedpage.SaveHandler)
	apiGroup.GET("/saved-pages", savedpage.ListHandler)
	apiGroup.GET("/saved-pages/export", savedpage.ExportHandler)
	apiGroup.PATCH("/saved-pages/:id", savedpage.UpdateHandler)
	apiGroup.DELETE("/saved-pages/:id", savedpage.DeleteHandler)
	apiGroup.DELETE("/saved-pages", savedpage.DeleteAllHandler)

	// Admin: grant top-up credits to any user by email. Gated by the
	// ADMIN_CLERK_USER_IDS allowlist inside the handler (on top of clerkAuth).
	apiGroup.POST("/admin/credits/grant", billingHandler.GrantCredits)

	// Admin: dictionary maintenance (ADR-021). Gated by RequireAdmin (same
	// ADMIN_CLERK_USER_IDS allowlist). Deliberately not on the user lookup
	// path -- raw rows, no metering, no ECDICT backfill.
	adminDict := apiGroup.Group("/admin")
	adminDict.Use(middleware.RequireAdmin())
	{
		adminDict.GET("/words/:word", handlers.AdminGetWord)
		adminDict.GET("/ai-words", handlers.AdminListAIWords)
		adminDict.PUT("/words/:word", handlers.AdminEditWord)
		adminDict.DELETE("/words/:word", handlers.AdminDeleteWord)
		adminDict.GET("/ecdict/:word", handlers.AdminGetEcdict)
		adminDict.POST("/words/:word/sync-from-ecdict", handlers.AdminSyncWordFromEcdict)
		// Page reports (ADR-010 Decision 11): read-only queue of user-confirmed
		// learning-mode failures. Not on the metered path.
		adminDict.GET("/page-reports", pagereport.ListHandler)
	}

	// Stripe webhook — deliberately NOT in apiGroup/authGroup: Stripe can't
	// present a Clerk session JWT, so this is unauthenticated at the router root,
	// relying on Stripe-Signature verification instead (TASK-SPEC §3). URL
	// must match the endpoint registered in infra/stripe/opentofu/enx
	// (w10n-config): enx-api.wiloon.lab/billing/webhook, no /api prefix.
	router.POST("/billing/webhook", billingHandler.Webhook)

	return router
}

func tokenPricing(p config.TokenPrice) credit.TokenPricing {
	return credit.TokenPricing{WeightIn: p.WeightIn, WeightOut: p.WeightOut, Divisor: p.Divisor}
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
