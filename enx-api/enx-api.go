package main

import (
	"context"
	"enx-api/aitranslate"
	"enx-api/aitranslate/aicfg"
	"enx-api/billing"
	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/ecdict"
	"enx-api/enx"
	"enx-api/handlers"
	"enx-api/middleware"
	"enx-api/pagereport"
	"enx-api/paragraph"
	"enx-api/reader"
	"enx-api/repo"
	"enx-api/stats"
	"enx-api/translate"
	"enx-api/utils"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	wordCount "enx-api/word"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func main() {
	fmt.Println("enx-api start...")

	utils.ViperInit()
	devMode := viper.GetBool("enx.dev-mode")
	fmt.Println("devMode:", devMode)

	// deploy to docker/k8s, disable file output
	logger.Init("CONSOLE", "debug", "enx-api")
	logger.Debug("debug log test")
	logger.Warn("warn log test")
	logger.Warnf("warnf log test %s", "test")
	logger.Sync()
	sqlitex.Init()

	ecdictDbPath := viper.GetString("ecdict.db_path")
	ecdict.Init(ecdictDbPath)

	go runReaderDocumentCleanup()
	go runStatsIngestLogCleanup()
	go runPageReportCleanup()

	router := setupRouter()

	port := viper.GetInt("enx.port")
	listenAddress := fmt.Sprintf(":%d", port)
	srv := newServer(listenAddress, router)

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
// WriteTimeout is derived from aicfg.RequestTimeout() instead of being its
// own constant because the two are not independent: Go's WriteTimeout starts
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
//
// Callers must run utils.ViperInit() first: aicfg.RequestTimeout() reads viper.
func newServer(addr string, handler http.Handler) *http.Server {
	writeTimeout := aicfg.RequestTimeout() + writeTimeoutHeadroom
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

func setupRouter() *gin.Engine {
	// ReleaseMode
	gin.SetMode(gin.DebugMode)
	router := gin.New()

	// Add Recovery middleware to recover from panics
	router.Use(gin.Recovery())

	// Add detailed CORS and request logging middleware BEFORE CORS
	router.Use(func(c *gin.Context) {
		logger.Debugf("🔵 [PRE-CORS] %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())
		logger.Debugf("📋 Origin='%s'", c.GetHeader("Origin"))

		c.Next()

		logger.Debugf("✅ [PRE-CORS] %d %s %s", c.Writer.Status(), c.Request.Method, c.Request.URL.Path)
	})

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
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
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

	// Add detailed CORS and request logging middleware AFTER CORS
	router.Use(func(c *gin.Context) {
		logger.Infof("🔵 %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())
		logger.Infof("📋 Headers: X-Session-ID='%s', Content-Type='%s', Origin='%s'",
			c.GetHeader("X-Session-ID"), c.GetHeader("Content-Type"), c.GetHeader("Origin"))
		logger.Debugf("🌐 User-Agent: %s", c.GetHeader("User-Agent"))

		// Check if this is a preflight request
		if c.Request.Method == "OPTIONS" {
			logger.Infof("✈️  CORS Preflight request")
		}

		c.Next()

		logger.Infof("✅ %d %s %s", c.Writer.Status(), c.Request.Method, c.Request.URL.Path)
		logger.Debugf("📤 Response Headers: %+v", c.Writer.Header())
	})

	router.GET("/ping", Ping)

	// Version information API - no authentication required
	router.GET("/version", handlers.GetVersion)
	router.GET("/api/version", handlers.GetVersionSimple)

	clerkAuth := middleware.ClerkAuth(middleware.ClerkConfigFromViper())

	// Sentence translation is an optional feature: if sentence-translate.provider
	// is unset, it stays disabled (same "unconfigured but not fatal" pattern as
	// ECDICT when ecdict.db_path is empty) and the endpoint responds 502. But if
	// a provider WAS explicitly configured and its credentials/config are
	// missing, that's a deliberate misconfiguration and must fail fast rather
	// than silently serving a broken endpoint (see
	// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §4.4).
	sentenceTranslator, sentenceTranslateErr := aitranslate.New(context.Background())
	if sentenceTranslateErr != nil {
		if provider := viper.GetString("sentence-translate.provider"); provider != "" {
			logger.Errorf("sentence-translate.provider=%q is configured but failed to initialize: %v", provider, sentenceTranslateErr)
			os.Exit(1)
		}
		logger.Warnf("sentence translation disabled: %v", sentenceTranslateErr)
		sentenceTranslator = nil
	}
	sentenceHandler := aitranslate.NewHandler(
		sentenceTranslator,
		aitranslate.DefaultTokenLedger,
		credit.TokenPricing{
			WeightIn:  viper.GetInt64("stripe.costs.translate.weight-in"),
			WeightOut: viper.GetInt64("stripe.costs.translate.weight-out"),
			Divisor:   viper.GetInt64("stripe.costs.translate.divisor"),
		},
	)

	// Rephrase (ADR-012) reuses the same provider as sentence translation,
	// but the provider must also implement rephrase support. Same
	// "unconfigured is not fatal, misconfigured is" contract as above.
	rephraser, rephraseErr := aitranslate.NewRephraser(context.Background())
	if rephraseErr != nil {
		if provider := viper.GetString("sentence-translate.provider"); provider != "" {
			logger.Errorf("sentence-translate.provider=%q is configured but rephrase failed to initialize: %v", provider, rephraseErr)
			os.Exit(1)
		}
		logger.Warnf("rephrase disabled: %v", rephraseErr)
		rephraser = nil
	}
	rephraseHandler := aitranslate.NewRephraseHandler(
		rephraser,
		aitranslate.DefaultTokenLedger,
		credit.TokenPricing{
			WeightIn:  viper.GetInt64("stripe.costs.rephrase.weight-in"),
			WeightOut: viper.GetInt64("stripe.costs.rephrase.weight-out"),
			Divisor:   viper.GetInt64("stripe.costs.rephrase.divisor"),
		},
	)

	// Stripe billing is likewise optional: without STRIPE_SECRET_KEY (a local
	// dev box, or a deployment that hasn't set the secret yet), billing
	// endpoints stay disabled (503) rather than the server failing to start.
	// See docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md.
	stripeClient, stripeErr := billingstripe.New(viper.GetString("stripe.secret-key"))
	if stripeErr != nil {
		logger.Warnf("billing disabled: %v", stripeErr)
		stripeClient = nil
	}
	billingHandler := billing.NewHandler(stripeClient, viper.GetString("app.frontend-base-url"), viper.GetString("stripe.webhook-secret"))

	// APIs requiring authentication (Clerk session JWT)
	authGroup := router.Group("/")
	authGroup.Use(clerkAuth)
	authGroup.Use(stats.TZOffsetMiddleware())
	{
		// get words query count by paragraph
		authGroup.GET("/paragraph-init", paragraph.ParagraphInit)

		// translate
		authGroup.GET("/translate", translate.Translate)
		authGroup.GET("/word/:word", translate.TranslateByWord)
		authGroup.POST("/translate/sentence", sentenceHandler.TranslateSentence)
		authGroup.POST("/translate/word-in-context", sentenceHandler.TranslateWordInContext)
		authGroup.POST("/translate/sentence-with-word", sentenceHandler.TranslateSentenceWithWord)
		authGroup.POST("/rephrase", rephraseHandler.Rephrase)
		authGroup.GET("/load-count", wordCount.LoadCount)
		authGroup.POST("/mark", MarkWord)
		authGroup.GET("/wrap", Wrap)
	}

	// API group for Kong gateway (with /api prefix)
	apiGroup := router.Group("/api")
	apiGroup.Use(clerkAuth)
	// Carries X-Enx-Tz-Offset down to dictionary.MeterLookup so a lookup is
	// counted under the caller's own day (ADR-029 Decision 7a).
	apiGroup.Use(stats.TZOffsetMiddleware())
	{
		// get words query count by paragraph
		apiGroup.GET("/paragraph-init", paragraph.ParagraphInit)

		// translate
		apiGroup.GET("/translate", translate.Translate)
		apiGroup.GET("/word/:word", translate.TranslateByWord)
		apiGroup.POST("/translate/sentence", sentenceHandler.TranslateSentence)
		apiGroup.POST("/translate/word-in-context", sentenceHandler.TranslateWordInContext)
		apiGroup.POST("/translate/sentence-with-word", sentenceHandler.TranslateSentenceWithWord)
		apiGroup.POST("/rephrase", rephraseHandler.Rephrase)
		apiGroup.DELETE("/word/:word", DeleteWord)
		apiGroup.GET("/load-count", wordCount.LoadCount)
		apiGroup.POST("/mark", MarkWord)
		apiGroup.GET("/wrap", Wrap)
	}

	// /api/me — requires authentication (Clerk session JWT)
	apiGroup.GET("/me", GetMe)

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

	// Admin: grant top-up credits to any user by email. Gated by the
	// ADMIN_CLERK_USER_IDS allowlist inside the handler (on top of clerkAuth).
	apiGroup.POST("/admin/credits/grant", billingHandler.GrantCredits)

	// Admin: dictionary maintenance (ADR-021). Gated by RequireAdmin (same
	// ADMIN_CLERK_USER_IDS allowlist). Deliberately not on the user lookup
	// path -- raw rows, no metering, no ECDICT backfill.
	adminDict := apiGroup.Group("/admin")
	adminDict.Use(middleware.RequireAdmin())
	{
		adminDict.GET("/words/:word", AdminGetWord)
		adminDict.GET("/ecdict/:word", AdminGetEcdict)
		adminDict.POST("/words/:word/sync-from-ecdict", AdminSyncWordFromEcdict)
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

	// Temporary test route - no authentication required
	router.POST("/mark-test", MarkWord)

	return router
}

type article struct {
	WidthMax int `json:"-"`
	Lines    []*line
}

func (a *article) appendWords(word string) {
	if len(a.Lines) == 0 {
		a.Lines = append(a.Lines, &line{})
	}
	tmp := a.Lines[len(a.Lines)-1]
	lineWidth := tmp.appendWords(word)
	if lineWidth > a.WidthMax {
		a.Lines = append(a.Lines, &line{})
	}
}

type line struct {
	width int
	Words []string
}

func (l *line) appendWords(word string) int {
	l.Words = append(l.Words, word)
	l.width = l.width + len(word) + 1
	return l.width
}

func Wrap(c *gin.Context) {
	text := c.Query("text")
	logger.Debugf("%s", text)
	text = strings.ReplaceAll(text, "\n", " ")
	arr := strings.Split(text, " ")
	a := article{}
	a.WidthMax = 80
	for _, v := range arr {
		a.appendWords(v)
	}
	c.JSON(200, a.Lines)
}

func MarkWord(c *gin.Context) {
	logger.Infof("MarkWord: Starting mark word request")

	word := enx.Word{}
	// set key
	err := c.BindJSON(&word)
	if err != nil {
		logger.Errorf("MarkWord: Failed to bind JSON: %v", err)
		c.JSON(400, gin.H{
			"success": false,
			"message": "Invalid request body",
		})
		return
	}
	logger.Infof("MarkWord: Successfully parsed word: %s", word.English)
	word.Key = strings.ToLower(word.English)

	// Get user ID from session context
	userId := middleware.GetUserIDFromContext(c)
	logger.Infof("MarkWord: Retrieved user ID from context: %s", userId)
	if userId == "" {
		logger.Errorf("MarkWord: No valid user id found in session context")
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	word.Translate(userId)

	ud := enx.UserDict{}
	ud.WordId = word.Id
	ud.UserId = userId

	// Load current state first (this is crucial!)
	ud.IsExist()
	logger.Infof("MarkWord: Before marking - AlreadyAcquainted: %d", ud.AlreadyAcquainted)

	ud.Mark() // This will toggle the state

	// Use the state after marking (no need to query again)
	word.LoadCount = ud.QueryCount
	word.AlreadyAcquainted = ud.AlreadyAcquainted

	logger.Infof("MarkWord: Word marked, new state AlreadyAcquainted: %d", ud.AlreadyAcquainted)
	c.JSON(200, word)
}

func DeleteWord(c *gin.Context) {
	word := c.Param("word")
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	logger.Infof("DeleteWord: deleting word=%s", word)

	// Find word ID first
	var w sqlitex.Word
	if err := sqlitex.DB.Where("english = ?", word).First(&w).Error; err == nil {
		// Delete user_dicts referencing this word
		sqlitex.DB.Where("word_id = ?", w.Id).Delete(&sqlitex.UserDict{})
	}

	// Delete from words table
	sqlitex.DB.Where("english = ?", word).Delete(&sqlitex.Word{})

	logger.Infof("DeleteWord: deleted word=%s", word)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "word cleared"})
}

func Ping(c *gin.Context) {
	c.JSON(200, gin.H{
		"message": "pong",
	})
}

// GetMe returns the current user's public fields including status. isAdmin
// reflects the ADMIN_CLERK_USER_IDS allowlist (ADR-021) and is the only
// signal enx-ui uses to decide whether to render the admin navigation; the
// allowlist itself stays server-side.
func GetMe(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}
	user := enx.GetUserByID(userID)
	if user.Id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "User not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":      user.Id,
		"name":    user.Name,
		"email":   user.Email,
		"status":  user.Status,
		"isAdmin": middleware.IsAdminClerkUser(c.GetString("clerk_user_id")),
	})
}

// ---------------------------------------------------------------------------
// Admin dictionary maintenance (ADR-021). Kept in enx-api.go with the rest of
// package main because the Containerfile builds `go build enx-api.go` (a
// single file), not `go build .` -- a sibling .go file would be dropped.
//
// These handlers are independent of the user lookup path
// (translate.TranslateByWord / translateWord): no metering, no words/ECDICT
// merge-or-short-circuit, no ECDICT backfill, no user_dicts review counting.
// They return each table's raw row so an admin can compare `words` against
// ECDICT and, if wanted, copy ECDICT's data onto the `words` row. Gated by
// middleware.RequireAdmin on the route.

// adminWordRow is a words-table row for the maintenance page -- every column,
// tombstones (deleted_at) included.
type adminWordRow struct {
	Found         bool   `json:"found"`
	Id            string `json:"id,omitempty"`
	English       string `json:"english,omitempty"`
	Chinese       string `json:"chinese,omitempty"`
	Pronunciation string `json:"pronunciation,omitempty"`
	LoadCount     int    `json:"loadCount,omitempty"`
	CreatedAt     int64  `json:"createdAt,omitempty"`
	UpdatedAt     int64  `json:"updatedAt,omitempty"`
	DeletedAt     *int64 `json:"deletedAt,omitempty"`
}

func adminWordRowFrom(w *repo.Word) adminWordRow {
	return adminWordRow{
		Found:         true,
		Id:            w.Id,
		English:       w.English,
		Chinese:       w.Chinese,
		Pronunciation: w.Pronunciation,
		LoadCount:     w.LoadCount,
		CreatedAt:     w.CreatedAt,
		UpdatedAt:     w.UpdatedAt,
		DeletedAt:     w.DeletedAt,
	}
}

// adminEcdictRow is the matched ECDICT stardict row plus which fallback
// strategy hit ("exact" / "lower" / "sw" / "exchange").
type adminEcdictRow struct {
	Found       bool   `json:"found"`
	MatchedBy   string `json:"matchedBy,omitempty"`
	Word        string `json:"word,omitempty"`
	Sw          string `json:"sw,omitempty"`
	Phonetic    string `json:"phonetic,omitempty"`
	Translation string `json:"translation,omitempty"`
	Exchange    string `json:"exchange,omitempty"`
}

// AdminGetWord handles GET /api/admin/words/:word.
func AdminGetWord(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	row, found := repo.AdminGetWord(word)
	if !found {
		c.JSON(http.StatusOK, adminWordRow{Found: false})
		return
	}
	c.JSON(http.StatusOK, adminWordRowFrom(row))
}

// AdminGetEcdict handles GET /api/admin/ecdict/:word.
func AdminGetEcdict(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	if !ecdict.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": ecdict.UnavailableMessage()})
		return
	}
	row, matchedBy, found := ecdict.LookupRaw(c.Request.Context(), word)
	if !found {
		c.JSON(http.StatusOK, adminEcdictRow{Found: false})
		return
	}
	c.JSON(http.StatusOK, adminEcdictRow{
		Found:       true,
		MatchedBy:   matchedBy,
		Word:        row.Word,
		Sw:          row.Sw,
		Phonetic:    row.Phonetic,
		Translation: row.Translation,
		Exchange:    row.Exchange,
	})
}

// AdminSyncWordFromEcdict handles POST /api/admin/words/:word/sync-from-ecdict:
// copy the matched ECDICT row's translation/phonetic onto the words-table row
// (creating it if absent). The words table is a global shared cache, so this
// affects every user's next lookup of this word.
func AdminSyncWordFromEcdict(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	if !ecdict.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": ecdict.UnavailableMessage()})
		return
	}

	eRow, matchedBy, found := ecdict.LookupRaw(c.Request.Context(), word)
	if !found {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "no ECDICT entry to sync from"})
		return
	}

	before, _ := repo.AdminGetWord(word)
	after, err := repo.AdminSyncWordFromEcdict(word, eRow.Translation, eRow.Phonetic)
	if err != nil {
		logger.Errorf("AdminSyncWordFromEcdict: word=%q: %v", word, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to update word"})
		return
	}

	beforeChinese, beforePron := "", ""
	if before != nil {
		beforeChinese, beforePron = before.Chinese, before.Pronunciation
	}
	logger.Infof("admin AdminSyncWordFromEcdict: %s synced word=%q from ECDICT (matchedBy=%s): chinese %q -> %q, pronunciation %q -> %q",
		c.GetString("clerk_user_id"), word, matchedBy, beforeChinese, after.Chinese, beforePron, after.Pronunciation)

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"matchedBy": matchedBy,
		"word":      adminWordRowFrom(after),
	})
}
