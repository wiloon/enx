package server

import (
	"context"
	"enx-api/account"
	accountadapters "enx-api/account/adapters"
	"enx-api/adminuser"
	"enx-api/ailimit"
	"enx-api/aitranslate"
	"enx-api/aitranslate/worddef"
	"enx-api/billing"
	billingapp "enx-api/billing/app"
	"enx-api/billing/checkout"
	"enx-api/billing/credit"
	"enx-api/billing/creditledger"
	"enx-api/billing/deletion"
	billingstripe "enx-api/billing/stripe"
	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/dictionary/adapters"
	dictionaryhttp "enx-api/dictionary/httpapi"
	"enx-api/email"
	"enx-api/enx"
	"enx-api/feedback"
	feedbackadapters "enx-api/feedback/adapters"
	"enx-api/handlers"
	"enx-api/metrics"
	"enx-api/middleware"
	"enx-api/preferences"
	prefadapters "enx-api/preferences/adapters"
	"enx-api/ratelimit"
	"enx-api/reader"
	"enx-api/reader/saving"
	"enx-api/referral"
	refadapters "enx-api/referral/adapters"
	"enx-api/repo"
	"enx-api/savedpage"
	"enx-api/stats"
	"enx-api/translate"
	"enx-api/userstats"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"enx-api/wordlist"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

// GinMode ties gin's mode to the log level: debug keeps gin's route dump and
// warnings, anything else (production defaults to info) runs release.
func GinMode(logLevel string) string {
	if strings.EqualFold(strings.TrimSpace(logLevel), "debug") {
		return gin.DebugMode
	}
	return gin.ReleaseMode
}

func setupRouter(cfg *config.Config, m *metrics.Metrics) *gin.Engine {
	return setupRouterWithStripe(cfg, m, StripeClient(cfg))
}

// StripeClient is the Stripe client the config names, or nil when billing is
// off.
func StripeClient(cfg *config.Config) *stripeSDK.Client {
	// The billing assembly validates required configuration before workers start.
	client, err := billingstripe.New(cfg.Stripe.SecretKey.Reveal(), cfg.Stripe.APIBaseURL)
	if err != nil {
		logger.Warnf("billing disabled: %v", err)
		return nil
	}
	return client
}

// setupRouterWithStripe is setupRouter on the given Stripe client (nil turns
// billing off). End-to-end tests hand in a client backed by a local fake.
func setupRouterWithStripe(cfg *config.Config, m *metrics.Metrics, stripeClient *stripeSDK.Client) *gin.Engine {
	return setupRouterWithClients(cfg, m, stripeClient, clerkBackend(cfg.Clerk))
}

// clerkBackend is the Clerk Backend API client (ADR-062 Decision 8); nil
// without CLERK_SECRET_KEY, which leaves deletion, disabling and signing out
// off (503) and everything else working.
func clerkBackend(c config.Clerk) account.Clerk {
	if c.SecretKey == "" {
		logger.Warnf("account deletion, disable and session revoke are off: CLERK_SECRET_KEY is not set")
		return nil
	}
	return accountadapters.NewClerk(c.SecretKey.Reveal())
}

// setupRouterWithClients is setupRouterWithStripe with the Clerk Backend API
// client given too (nil: not configured).
func setupRouterWithClients(cfg *config.Config, m *metrics.Metrics, stripeClient *stripeSDK.Client, clerk account.Clerk) *gin.Engine {
	return setupRouterWithBilling(cfg, m, stripeClient, clerk, nil)
}

func setupRouterWithBilling(cfg *config.Config, m *metrics.Metrics, stripeClient *stripeSDK.Client, clerk account.Clerk, assembly *billingapp.Assembly) *gin.Engine {
	router := gin.New()

	// Metrics and the request log wrap Recovery, so a recovered panic is
	// recorded as the 500 Recovery writes (ADR-040).
	router.Use(m.Middleware())
	// One structured line per request (route template, status, duration,
	// user) instead of free-text request logging.
	router.Use(middleware.RequestLog(logger.Infow))
	router.Use(gin.Recovery())

	router.Use(middleware.CORS(cfg.Clerk.AuthorizedParties))

	router.GET("/ping", handlers.Ping)

	// Version information API - no authentication required
	router.GET("/version", handlers.GetVersion)
	router.GET("/api/version", handlers.GetVersionSimple)

	admins := middleware.NewAdminAllowlist(cfg.Admin.ClerkUserIDs)
	clerkAuth := middleware.ClerkAuth(middleware.ClerkConfigFrom(cfg.Clerk, cfg.User), m)

	// Word lookup (ADR-018): the dictionary domain service over the words
	// table and ECDICT, plus the per-user review log.

	// One entitlement judgement (ADR-045 Decision 14) for the lookup, which
	// hides AI-made definitions from users who can't use AI, and for the
	// preferences, whose editability follows the same rule.
	readers := newBillingReaders()
	subscriptions := readers.subscriptions
	entitlements := readers.entitlements

	// Sign-up trial (ADR-048): every new account gets the trial credits, and
	// users whose AI access comes from the trial alone are held to its call
	// rate on every AI feature.
	// The trial is once per email too (ADR-062 Decision 3), checked against
	// the trial grant record by the email's HMAC.
	emailHMAC := account.NewEmailHMAC(cfg.Account.EmailHMACKey.Reveal())
	enx.SetNewUserHook(billing.TrialGrant{
		Amount:    cfg.Credits.Trial.Amount,
		TTL:       time.Duration(cfg.Credits.Trial.TTLDays) * 24 * time.Hour,
		EmailHMAC: emailHMAC.Of,
		Observe:   m.ObserveTrialGrant,
	})
	trialGate := ailimit.NewTrialGate(entitlements, ailimit.NewMemoryLimiter(ailimit.Limits{
		CallsPerMinute: cfg.Credits.Trial.CallsPerMinute,
		CallsPerDay:    cfg.Credits.Trial.CallsPerDay,
	}, nil))

	// The daily lookup quota (ADR-079 Decision 5): each caller charges it
	// before it resolves; dictionaryService itself never does.
	lookupQuota := dictionary.NewQuotaMeter(adapters.QuotaUsage{}, subscriptions, cfg.Stripe.Quota, time.Now)
	dictionaryService := dictionary.NewService(adapters.WordsTable{}, adapters.Ecdict{}, entitlements)
	preferencesService := preferences.NewService(prefadapters.Table{}, entitlements)

	// The AI word fallback (ADR-045) is a second request after a lookup
	// missed. The policy decides what that miss offers each user; the service
	// itself is switched on below, once the AI provider exists.
	aiPolicy := adapters.AIPolicy{Service: dictionaryService, Entitlements: entitlements, Preferences: preferencesService}
	lookupHandler := translate.NewHandlerWithSubscriptions(dictionaryService, lookupQuota, repo.ReviewLog{}, subscriptions).WithAI(
		dictionaryService, aiPolicy,
	)
	// Batch definitions (ADR-079 Decision 1): the quota, no lookup event.
	entriesHandler := dictionaryhttp.NewHandler(dictionary.NewEntries(dictionaryService, lookupQuota, aiPolicy, adapters.LookedUpWords{}), subscriptions)

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

	// Invite links (ADR-051): the webhook reports each payment, the claim
	// and summary endpoints sit behind clerkAuth, the offer is public.
	referrals := NewReferralService(cfg, stripeClient, m)
	referralHandler := handlers.NewReferralHandler(referrals, cfg.App.FrontendBaseURL)
	billingHandler := billing.NewHandler(stripeClient, cfg.App.FrontendBaseURL, cfg.Stripe.Price, repo.BillingSubscriptions{}, checkout.New(repo.PortalSessionOwners{}, billingstripe.NewPortalClient(stripeClient, "", "", nil)))

	// Authenticated APIs (Clerk session JWT). enx-chrome and enx-ui call only
	// these /api routes; nothing is registered twice at the root.
	apiGroup := router.Group("/api")
	apiGroup.Use(clerkAuth)
	// Per-user request rate limit (ADR-060): right after clerkAuth, which
	// puts the local user id in the context; a refused request does no
	// further work.
	apiGroup.Use(middleware.RateLimit(ratelimit.NewMemoryLimiter(ratelimit.Limits{
		RequestsPerSecond: cfg.RateLimit.RequestsPerSecond,
		Burst:             cfg.RateLimit.Burst,
	}, nil), m))
	// Carries X-Enx-Tz-Offset down to dictionary.WordLookups, which stores
	// it on each lookup event so the event's local day is known (ADR-059
	// Decision 1).
	apiGroup.Use(stats.TZOffsetMiddleware())
	{
		// translate
		apiGroup.GET("/translate", lookupHandler.Translate)
		apiGroup.GET("/word/:word", lookupHandler.TranslateByWord)
		// ADR-079 Decision 1, ADR-041 C: QUERY is the default, POST the
		// fallback for networks that reject QUERY.
		apiGroup.Handle("QUERY", "/dictionary/entries", entriesHandler.Entries)
		apiGroup.POST("/dictionary/entries/query", entriesHandler.Entries)
		apiGroup.POST("/dictionary/ai-word", lookupHandler.AIWord)
		apiGroup.POST("/translate/sentence", sentenceHandler.TranslateSentence)
		apiGroup.POST("/translate/word-in-context", sentenceHandler.TranslateWordInContext)
		apiGroup.POST("/translate/sentence-with-word", sentenceHandler.TranslateSentenceWithWord)
		apiGroup.POST("/rephrase", rephraseHandler.Rephrase)
	}

	// /api/me — requires authentication (Clerk session JWT)
	apiGroup.GET("/me", handlers.GetMe(admins))

	// Account deletion, disable and session revoke (ADR-062). One Delete
	// serves the user's own (DELETE /api/me) and the admin's.
	accountService := account.NewService(
		repo.Accounts{}, repo.TrialGrants{Hash: emailHMAC.Of}, clerk,
		nil, admins, emailHMAC, time.Now)
	{
		accountService.WithDeletionChecker(deletion.New(repo.SubscriptionOwners{}, billingstripe.NewWorkerClient(stripeClient))).
			WithDeletionCoordinator(repo.AccountDeletions{})
	}
	accountHandler := handlers.NewAccountHandler(accountService)
	apiGroup.DELETE("/me", accountHandler.DeleteMe)

	// Server-side user preferences (ADR-044): the AI word fallback switch and
	// its one-time notice. Defaults and editability follow the user's payment
	// state (ADR-045 Decision 14).
	preferencesHandler := handlers.NewPreferencesHandler(preferencesService)
	apiGroup.GET("/me/preferences", preferencesHandler.Get)
	apiGroup.PUT("/me/preferences", preferencesHandler.Update)

	// The user's word list: every word they looked up in an article,
	// including the ones marked known. Not on the metered path; removing a
	// word puts it back to never looked up.
	apiGroup.GET("/me/words", wordlist.ListHandler)
	apiGroup.DELETE("/me/words/:english", wordlist.RemoveHandler)
	// Mark Known (#133): idempotent, so the extension can retry it.
	apiGroup.PUT("/me/words/:english/known", handlers.SetWordKnown)
	apiGroup.DELETE("/me/words/:english/known", handlers.ClearWordKnown)
	// The review list the extension underlines from (ADR-069 Decision 1):
	// one request per page, no page text. Successful loads are the
	// "pages enabled" count in Grafana.
	apiGroup.GET("/me/review-words", handlers.NewReviewWordsHandler(repo.ReviewWords{}).List)
	// One click-to-lookup (ADR-059 Decision 3, ADR-079 Decision 1): one
	// against the quota, the query count +1 and one lookup event. By word
	// id, so an inflection counts against the headword the lookup resolved
	// to. Not idempotent: the extension never retries it.
	wordLookupHandler := handlers.NewWordLookupHandlerWithSubscriptions(
		dictionary.NewWordLookups(adapters.WordLookupRecords{}, lookupQuota, adapters.LookupEvents{}, time.Now), subscriptions)
	apiGroup.POST("/me/word-lookups", wordLookupHandler.Record)

	// Billing (Stripe) — requires authentication (Clerk session JWT).
	apiGroup.POST("/billing/checkout/subscription", billingHandler.CheckoutSubscription)
	apiGroup.POST("/billing/checkout/topup", billingHandler.CheckoutTopup)
	apiGroup.GET("/billing/me", billingHandler.Me)
	// The user's own credit ledger (ADR-063 Decision 3), read the same way
	// as the admin's timeline of them.
	apiGroup.GET("/me/credits/transactions", handlers.NewCreditHistoryHandler(creditledger.NewReader(repo.CreditLedger{})).List)

	// Invite links (ADR-051): the user's code and invites, and claiming an
	// invite in the first hours after sign-up.
	apiGroup.GET("/referral/me", referralHandler.Me)
	apiGroup.POST("/referral/claim", referralHandler.Claim)

	// Reader (ADR-022): enx-ui's pasted-text documents. 20,000-char limit and
	// 50-document-per-user cap are enforced on creation; versioned saves
	// are serialized by saving.SaveService and repo.ReaderDocuments. The 7-day
	// TTL is enforced by runReaderDocumentCleanup plus the expiry filter
	// baked into reader.ListDocuments / reader.GetDocument.
	apiGroup.POST("/reader/documents", reader.CreateDocumentHandler)
	apiGroup.GET("/reader/documents", reader.ListDocumentsHandler)
	apiGroup.GET("/reader/documents/:id", reader.GetDocumentHandler)
	apiGroup.PUT("/reader/documents/:id", reader.NewSaveDocumentHandler(saving.NewSaveService(repo.ReaderDocuments{DB: sqlitex.DB})))
	apiGroup.DELETE("/reader/documents/:id", reader.DeleteDocumentHandler)

	// Reading statistics (ADR-028). Deliberately NOT on the metered path:
	// these look up no words, call no model and touch no credits, so they
	// sit outside ADR-018's single metering seam (same as admin/ADR-021).
	apiGroup.POST("/stats/ingest", stats.IngestHandler(cfg.Stats.Ingest))
	apiGroup.GET("/stats/overview", stats.OverviewHandler)
	apiGroup.GET("/stats/series", stats.SeriesHandler)

	// User feedback (ADR-076): records the user chose to send, such as a
	// confirmed "this page didn't work" report. Stores a cleaned URL, so the
	// extension only calls it after the user confirms. Not on the metered path.
	feedbackHandler := feedback.NewHandler(feedback.NewService(feedbackadapters.Table{},
		feedbackadapters.Mail{Sender: email.NewSender(cfg.Resend)}, cfg.Feedback.DailyLimit, time.Now))
	apiGroup.POST("/feedback", feedbackHandler.Submit)

	// Pages the user chose to save (ADR-032): URL + title only, readable and
	// editable by that user alone -- there is deliberately no admin route.
	// Not on the metered path.
	apiGroup.POST("/saved-pages", savedpage.SaveHandler)
	apiGroup.GET("/saved-pages", savedpage.ListHandler)
	apiGroup.GET("/saved-pages/export", savedpage.ExportHandler)
	apiGroup.PATCH("/saved-pages/:id", savedpage.UpdateHandler)
	apiGroup.DELETE("/saved-pages/:id", savedpage.DeleteHandler)
	apiGroup.DELETE("/saved-pages", savedpage.DeleteAllHandler)

	// Admin routes, gated by RequireAdmin (ADMIN_CLERK_USER_IDS allowlist).
	adminDict := apiGroup.Group("/admin")
	adminDict.Use(admins.Require())
	{
		// Credits by email, with a required reason (ADR-049 Decision 2/3).
		adminDict.POST("/credits/grant", billingHandler.GrantCredits)
		adminDict.POST("/credits/deduct", billingHandler.DeductCredits)
		// Dictionary maintenance (ADR-021). Deliberately not on the user
		// lookup path -- raw rows, no metering, no ECDICT backfill.
		adminDict.GET("/words/:word", handlers.AdminGetWord)
		adminDict.GET("/ai-words", handlers.AdminListAIWords)
		adminDict.PUT("/words/:word", handlers.AdminEditWord)
		adminDict.DELETE("/words/:word", handlers.AdminDeleteWord)
		adminDict.GET("/ecdict/:word", handlers.AdminGetEcdict)
		adminDict.POST("/words/:word/sync-from-ecdict", handlers.AdminSyncWordFromEcdict)
		// The feedback queue (ADR-076 Decision 7-8): filter by kind and status,
		// mark a record resolved. Not on the metered path.
		adminDict.GET("/feedback", feedbackHandler.List)
		adminDict.PATCH("/feedback/:id", feedbackHandler.Resolve)
		adminDict.GET("/feedback/article-choices", feedbackHandler.ListArticleChoiceGroups)
		adminDict.POST("/feedback/article-choices/resolve", feedbackHandler.ResolveArticleChoiceGroup)
		// Users and billing (ADR-049 Decision 11): accounts, balances and
		// usage counts only, never saved pages or looked-up words.
		adminUsers := adminuser.NewHandler(adminuser.NewService(readers.admin,
			strings.HasPrefix(cfg.Stripe.SecretKey.Reveal(), "sk_live_"), time.Now))
		adminDict.GET("/users", adminUsers.List)
		adminDict.GET("/users/:id", adminUsers.Detail)
		adminDict.GET("/users/:id/transactions", adminUsers.Transactions)
		// ADR-062 Decision 4-7: the admin's account actions. An account in
		// ADMIN_CLERK_USER_IDS can be neither disabled nor deleted.
		adminDict.POST("/users/:id/revoke-sessions", accountHandler.RevokeSessions)
		adminDict.POST("/users/:id/disable", accountHandler.Disable)
		adminDict.POST("/users/:id/enable", accountHandler.Enable)
		adminDict.DELETE("/users/:id", accountHandler.Delete)
	}

	// Stripe webhook — deliberately NOT in apiGroup/authGroup: Stripe can't
	// present a Clerk session JWT, so this is unauthenticated at the router root,
	// relying on Stripe-Signature verification instead (TASK-SPEC §3). URL
	// must match the endpoint registered in infra/stripe/opentofu/enx
	// (w10n-config): enx-api.wiloon.lab/billing/webhook, no /api prefix.
	if assembly != nil {
		assembly.Mount(apiGroup, adminDict, router)
	}

	// What an invitee gets, for enx-ui's signed-out /invite/<code> landing
	// page (ADR-051 Decision 8). Not in apiGroup: no session yet. Config
	// numbers only, nothing about any user.
	router.GET("/api/referral/offer", referralHandler.Offer)

	// Site-wide user numbers for Grafana's Infinity datasource (ADR-058
	// Decision 4). Not in apiGroup: Grafana has no Clerk session and presents
	// the OPS_STATS_TOKEN bearer instead; without the token the handler
	// answers 404. Counts only, no user ids.
	userStatsDaily := userstats.NewDailyHandler(
		userstats.NewService(repo.UserStats{}, time.Now), cfg.Ops.StatsToken.Reveal(), time.Now)
	router.GET("/api/ops/user-stats/daily", userStatsDaily.Serve)

	return router
}

// NewReferralService builds the invite-link service (ADR-051). sc may be nil
// (billing off): claims still work, rewards then stay pending.
func NewReferralService(cfg *config.Config, sc *stripeSDK.Client, m *metrics.Metrics) *referral.Service {
	var payments referral.PaymentChecker
	if sc != nil {
		payments = refadapters.Stripe{Client: sc}
	}
	policy := newReferralPolicy(cfg)
	// A deleted account signed up again gets no invite rewards (ADR-062
	// Decision 3), judged by the trial grant record.
	trials := repo.TrialGrants{Hash: account.NewEmailHMAC(cfg.Account.EmailHMACKey.Reveal()).Of}
	return referral.NewService(repo.ReferralCodes{}, repo.Referrals{}, repo.ReferralAccounts{Trials: trials},
		refadapters.Ledger{EmailHMAC: trials.EmailHMACOf}, payments, time.Now, policy).WithObserver(m)
}

func newReferralPolicy(cfg *config.Config) referral.FixedPolicy {
	const day = 24 * time.Hour
	r := cfg.Credits.Referral
	return referral.FixedPolicy{
		TrialAmount:                cfg.Credits.Trial.Amount,
		TrialTTL:                   time.Duration(cfg.Credits.Trial.TTLDays) * day,
		InviteeBonus:               r.InviteeBonus,
		InviteeTTL:                 time.Duration(r.InviteeTTLDays) * day,
		ReferrerRewardSubscription: r.ReferrerRewardSubscription,
		ReferrerRewardTopupPercent: r.ReferrerRewardTopupPercent,
		RewardDelay:                time.Duration(r.RewardDelayDays) * day,
		ClaimWindow:                time.Duration(r.ClaimWindowHours) * time.Hour,
	}
}

func tokenPricing(p config.TokenPrice) credit.TokenPricing {
	return credit.TokenPricing{WeightIn: p.WeightIn, WeightOut: p.WeightOut, Divisor: p.Divisor}
}
