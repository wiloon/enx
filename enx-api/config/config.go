// Package config reads enx-api's configuration once, at startup, into a typed
// Config (issue #45). It is the only package that talks to viper: everything
// else receives the sub-struct it needs through its constructor.
//
// Sources, lowest precedence first: the defaults set in Load, an optional
// TOML file, then the environment variables bound in Load. Production and
// homelab ship no config file, so an env var that is not bound here can never
// reach the app -- TestEveryFieldHasAnEnvVar guards against that.
package config

import (
	"errors"
	"fmt"
	"reflect"
	"runtime"
	"strings"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	Enx               Enx               `mapstructure:"enx"`
	DB                DB                `mapstructure:"db"`
	Log               Log               `mapstructure:"log"`
	Metrics           Metrics           `mapstructure:"metrics"`
	Ecdict            Ecdict            `mapstructure:"ecdict"`
	Resend            Resend            `mapstructure:"resend"`
	App               App               `mapstructure:"app"`
	Clerk             Clerk             `mapstructure:"clerk"`
	Admin             Admin             `mapstructure:"admin"`
	SentenceTranslate SentenceTranslate `mapstructure:"sentence-translate"`
	Stripe            Stripe            `mapstructure:"stripe"`
	AIWord            AIWord            `mapstructure:"ai-word"`
	Credits           Credits           `mapstructure:"credits"`
	Stats             Stats             `mapstructure:"stats"`
	User              User              `mapstructure:"user"`

	// File is the config file that was read, "" when none was.
	File string `mapstructure:"-"`
}

type Enx struct {
	Port    int  `mapstructure:"port"`
	DevMode bool `mapstructure:"dev-mode"`
}

type DB struct {
	Path string `mapstructure:"path"`
}

type Log struct {
	Level string `mapstructure:"level"`
}

type Metrics struct {
	Addr string `mapstructure:"addr"`
}

type Ecdict struct {
	DBPath   string `mapstructure:"db_path"`
	Sampling bool   `mapstructure:"sampling"`
}

type Resend struct {
	APIKey  string `mapstructure:"api-key"`
	From    string `mapstructure:"from"`
	AdminTo string `mapstructure:"admin-to"`
}

type App struct {
	FrontendBaseURL string `mapstructure:"frontend-base-url"`
}

type Clerk struct {
	Issuer            string   `mapstructure:"issuer"`
	AuthorizedParties []string `mapstructure:"authorized-parties"`
	JWKSURL           string   `mapstructure:"jwks-url"`
}

type Admin struct {
	ClerkUserIDs []string `mapstructure:"clerk-user-ids"`
}

type SentenceTranslate struct {
	Provider       string           `mapstructure:"provider"`
	RequestTimeout time.Duration    `mapstructure:"request-timeout"`
	Kimi           OpenAICompatible `mapstructure:"kimi"`
	MiniMax        MiniMax          `mapstructure:"minimax"`
	Bedrock        Bedrock          `mapstructure:"bedrock"`
	DeepSeek       OpenAICompatible `mapstructure:"deepseek"`
	Gemini         OpenAICompatible `mapstructure:"gemini"`
	OpenRouter     OpenAICompatible `mapstructure:"openrouter"`
}

// OpenAICompatible is the shape shared by kimi, deepseek, gemini and
// openrouter. RephraseModel empty means "use Model".
type OpenAICompatible struct {
	APIKey        string `mapstructure:"api-key"`
	BaseURL       string `mapstructure:"base-url"`
	Model         string `mapstructure:"model"`
	RephraseModel string `mapstructure:"rephrase-model"`
}

type MiniMax struct {
	APIKey  string `mapstructure:"api-key"`
	BaseURL string `mapstructure:"base-url"`
	Model   string `mapstructure:"model"`
	GroupID string `mapstructure:"group-id"`
}

type Bedrock struct {
	Region  string `mapstructure:"region"`
	ModelID string `mapstructure:"model-id"`
}

type Stripe struct {
	SecretKey     string        `mapstructure:"secret-key"`
	WebhookSecret string        `mapstructure:"webhook-secret"`
	Price         StripePrice   `mapstructure:"price"`
	Credits       StripeCredits `mapstructure:"credits"`
	Costs         StripeCosts   `mapstructure:"costs"`
	Quota         StripeQuota   `mapstructure:"quota"`
}

// StripePrice holds Stripe Price lookup_keys, not Price IDs.
type StripePrice struct {
	Pro                string `mapstructure:"pro"`
	ProPlus            string `mapstructure:"pro-plus"`
	Max                string `mapstructure:"max"`
	CreditsTopupSmall  string `mapstructure:"credits-topup-small"`
	CreditsTopupMedium string `mapstructure:"credits-topup-medium"`
	CreditsTopupLarge  string `mapstructure:"credits-topup-large"`
}

// StripeCredits is the credits granted per grant event. 0 means "not
// configured": the ledger rejects a grant of 0, so it fails closed.
type StripeCredits struct {
	SubscriptionPro     int64 `mapstructure:"subscription-pro"`
	SubscriptionProPlus int64 `mapstructure:"subscription-pro-plus"`
	SubscriptionMax     int64 `mapstructure:"subscription-max"`
	TopupSmall          int64 `mapstructure:"topup-small"`
	TopupMedium         int64 `mapstructure:"topup-medium"`
	TopupLarge          int64 `mapstructure:"topup-large"`
}

type StripeCosts struct {
	Translate  TokenPrice `mapstructure:"translate"`
	Rephrase   TokenPrice `mapstructure:"rephrase"`
	DefineWord TokenPrice `mapstructure:"define-word"`
}

// TokenPrice: cost = ceil((prompt*WeightIn + completion*WeightOut) / Divisor),
// floored at 1. Divisor 0 or both weights 0 means "not priced yet" and the
// feature fails closed.
type TokenPrice struct {
	WeightIn  int64 `mapstructure:"weight-in"`
	WeightOut int64 `mapstructure:"weight-out"`
	Divisor   int64 `mapstructure:"divisor"`
}

// StripeQuota is the daily dictionary lookup ceiling per tier (ADR-029).
// 0 means "count, but never block": it fails open, unlike costs and credits.
type StripeQuota struct {
	DictionaryLookupDailyFree       int64 `mapstructure:"dictionary-lookup-daily-free"`
	DictionaryLookupDailySubscribed int64 `mapstructure:"dictionary-lookup-daily-subscribed"`
	// DictionaryLookupDaily is the superseded single-tier key; read it
	// through FreeDailyLookupLimit.
	DictionaryLookupDaily int64 `mapstructure:"dictionary-lookup-daily"`
}

// FreeDailyLookupLimit is the free tier's ceiling. It falls back to the
// superseded single-tier key when -free is unset; legacy reports that it did,
// so the caller can warn about the deprecated key.
func (q StripeQuota) FreeDailyLookupLimit() (limit int64, legacy bool) {
	if q.DictionaryLookupDailyFree > 0 {
		return q.DictionaryLookupDailyFree, false
	}
	if q.DictionaryLookupDaily > 0 {
		return q.DictionaryLookupDaily, true
	}
	return 0, false
}

// AIWord tunes the AI word fallback (ADR-045). The per-user ceilings use
// 0 for "no ceiling"; CallTimeout 0 means the dictionary package's default.
type AIWord struct {
	MinQuality        int           `mapstructure:"min-quality"`
	CallsPerMinute    int           `mapstructure:"calls-per-minute"`
	CallsPerDay       int           `mapstructure:"calls-per-day"`
	CacheWritesPerDay int           `mapstructure:"cache-writes-per-day"`
	CallTimeout       time.Duration `mapstructure:"call-timeout"`
}

type Credits struct {
	Trial Trial `mapstructure:"trial"`
}

// Trial is the sign-up trial (ADR-048). Amount 0 switches trials off; the
// call ceilings use 0 for "no ceiling".
type Trial struct {
	Amount         int64 `mapstructure:"amount"`
	TTLDays        int   `mapstructure:"ttl-days"`
	CallsPerMinute int   `mapstructure:"calls-per-minute"`
	CallsPerDay    int   `mapstructure:"calls-per-day"`
}

type Stats struct {
	Ingest StatsIngest `mapstructure:"ingest"`
}

// StatsIngest guards reading statistics ingest (ADR-028 Decision 9).
type StatsIngest struct {
	MaxWordsPerReport int64 `mapstructure:"max-words-per-report"`
	LogTTLDays        int   `mapstructure:"log-ttl-days"`
}

type User struct {
	LastLoginUpdateInterval time.Duration `mapstructure:"last-login-update-interval"`
}

// Load reads the configuration. path is the -c flag: when set, that file must
// exist and parse. When empty, config.toml is searched for in
// /usr/local/etc/enx/, $HOME/.enx and the working directory, and a missing
// file is fine (k8s ships none). A .env file in the working directory, if
// present, is loaded into the environment first (local development).
//
// The result is validated: a malformed value, a key Config does not know, or
// a forbidden zero is an error, so a config mistake stops the process instead
// of silently falling back.
func Load(path string) (*Config, error) {
	_ = godotenv.Load()

	v := viper.New()
	setDefaults(v)
	bindEnv(v)

	if path != "" {
		v.SetConfigFile(path)
		if err := v.ReadInConfig(); err != nil {
			return nil, fmt.Errorf("config: read %s: %w", path, err)
		}
	} else {
		v.SetConfigName("config")
		v.SetConfigType("toml")
		v.AddConfigPath("/usr/local/etc/enx/")
		v.AddConfigPath("$HOME/.enx")
		v.AddConfigPath(".")
		if err := v.ReadInConfig(); err != nil {
			var notFound viper.ConfigFileNotFoundError
			if !errors.As(err, &notFound) {
				return nil, fmt.Errorf("config: read %s: %w", v.ConfigFileUsed(), err)
			}
		}
	}

	var cfg Config
	err := v.UnmarshalExact(&cfg, viper.DecodeHook(mapstructure.ComposeDecodeHookFunc(
		mapstructure.StringToTimeDurationHookFunc(),
		splitOnWhitespace,
	)))
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	cfg.File = v.ConfigFileUsed()

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// splitOnWhitespace decodes a string into a []string by splitting on
// whitespace. viper's default hook splits on commas, but the deployments set
// CLERK_AUTHORIZED_PARTIES and ADMIN_CLERK_USER_IDS space-separated; split on
// commas, every signed-in request would fail Clerk's azp check (401). A TOML
// array is already a slice and does not pass through here.
func splitOnWhitespace(from, to reflect.Type, data any) (any, error) {
	if from.Kind() != reflect.String || to != reflect.TypeOf([]string{}) {
		return data, nil
	}
	return strings.Fields(data.(string)), nil
}

// Validate reports every malformed value at once. Durations must parse (the
// decoder already rejects one that does not); negative numbers and durations
// are never meaningful. The four keys whose 0 used to fall back silently to a
// default must be positive. Intentional zeros stay valid: Stripe credits and
// costs at 0 mean "not configured, fail closed", Stripe quotas at 0 mean
// "count but never block", and the AI word and trial ceilings at 0 mean "no
// ceiling".
func (c *Config) Validate() error {
	var errs []error
	positive := func(key string, ok bool) {
		if !ok {
			errs = append(errs, fmt.Errorf("config: %s must be positive", key))
		}
	}
	notNegative := func(key string, ok bool) {
		if !ok {
			errs = append(errs, fmt.Errorf("config: %s must not be negative", key))
		}
	}

	if c.Enx.Port < 1 || c.Enx.Port > 65535 {
		errs = append(errs, fmt.Errorf("config: enx.port %d is not a valid port", c.Enx.Port))
	}

	positive("sentence-translate.request-timeout", c.SentenceTranslate.RequestTimeout > 0)
	positive("stats.ingest.max-words-per-report", c.Stats.Ingest.MaxWordsPerReport > 0)
	positive("stats.ingest.log-ttl-days", c.Stats.Ingest.LogTTLDays > 0)
	positive("user.last-login-update-interval", c.User.LastLoginUpdateInterval > 0)

	cr := c.Stripe.Credits
	notNegative("stripe.credits.subscription-pro", cr.SubscriptionPro >= 0)
	notNegative("stripe.credits.subscription-pro-plus", cr.SubscriptionProPlus >= 0)
	notNegative("stripe.credits.subscription-max", cr.SubscriptionMax >= 0)
	notNegative("stripe.credits.topup-small", cr.TopupSmall >= 0)
	notNegative("stripe.credits.topup-medium", cr.TopupMedium >= 0)
	notNegative("stripe.credits.topup-large", cr.TopupLarge >= 0)
	for name, p := range map[string]TokenPrice{
		"translate":   c.Stripe.Costs.Translate,
		"rephrase":    c.Stripe.Costs.Rephrase,
		"define-word": c.Stripe.Costs.DefineWord,
	} {
		notNegative("stripe.costs."+name+".weight-in", p.WeightIn >= 0)
		notNegative("stripe.costs."+name+".weight-out", p.WeightOut >= 0)
		notNegative("stripe.costs."+name+".divisor", p.Divisor >= 0)
	}
	q := c.Stripe.Quota
	notNegative("stripe.quota.dictionary-lookup-daily-free", q.DictionaryLookupDailyFree >= 0)
	notNegative("stripe.quota.dictionary-lookup-daily-subscribed", q.DictionaryLookupDailySubscribed >= 0)
	notNegative("stripe.quota.dictionary-lookup-daily", q.DictionaryLookupDaily >= 0)

	w := c.AIWord
	if w.MinQuality < 0 || w.MinQuality > 10 {
		errs = append(errs, fmt.Errorf("config: ai-word.min-quality %d is outside 0-10", w.MinQuality))
	}
	notNegative("ai-word.calls-per-minute", w.CallsPerMinute >= 0)
	notNegative("ai-word.calls-per-day", w.CallsPerDay >= 0)
	notNegative("ai-word.cache-writes-per-day", w.CacheWritesPerDay >= 0)
	notNegative("ai-word.call-timeout", w.CallTimeout >= 0)

	t := c.Credits.Trial
	notNegative("credits.trial.amount", t.Amount >= 0)
	notNegative("credits.trial.ttl-days", t.TTLDays >= 0)
	notNegative("credits.trial.calls-per-minute", t.CallsPerMinute >= 0)
	notNegative("credits.trial.calls-per-day", t.CallsPerDay >= 0)

	return errors.Join(errs...)
}

func defaultDBPath() string {
	if runtime.GOOS == "windows" {
		return "C:\\workspace\\apps\\enx\\enx.db"
	}
	return "/var/lib/enx-api/enx.db"
}

// setDefaults is the single source of truth for defaults: the app works with
// no config file at all.
func setDefaults(v *viper.Viper) {
	v.SetDefault("enx.port", 8091)
	v.SetDefault("enx.dev-mode", false)
	v.SetDefault("db.path", defaultDBPath())
	// Production ships no config.toml, so this default is what it runs at;
	// the repo's config.toml sets debug for local development.
	v.SetDefault("log.level", "info")
	// ADR-040: the /metrics listener. Loopback by default; homelab (k8s)
	// sets 0.0.0.0:9091 so the in-cluster Prometheus can reach the pod.
	v.SetDefault("metrics.addr", "127.0.0.1:9091")

	v.SetDefault("ecdict.db_path", "")
	// ADR-030 Decision 0: temporary lookup sampling (see the dictsample
	// package). Off by default -- it is measurement scaffolding with an
	// expiry date, and a deploy that forgets to disable it should cost
	// nothing.
	v.SetDefault("ecdict.sampling", false)

	v.SetDefault("resend.api-key", "")
	v.SetDefault("resend.from", "Catglish <no-reply@catglish.com>")
	v.SetDefault("resend.admin-to", "")
	v.SetDefault("app.frontend-base-url", "https://enx.wiloon.lab")

	v.SetDefault("sentence-translate.provider", "")
	// Per-call provider API timeout. 60s: MiniMax's M-series models "think"
	// before the first response byte, so the original hard-coded 10s timed
	// out on rephrase.
	v.SetDefault("sentence-translate.request-timeout", "60s")

	// Three subscription tiers (2026-08-26 decision) -- see config.toml's
	// [stripe.price] comment.
	v.SetDefault("stripe.price.pro", "enx_pro_monthly")
	v.SetDefault("stripe.price.pro-plus", "enx_pro_plus_monthly")
	v.SetDefault("stripe.price.max", "enx_max_monthly")
	v.SetDefault("stripe.price.credits-topup-small", "enx_credits_topup_small")
	v.SetDefault("stripe.price.credits-topup-medium", "enx_credits_topup_medium")
	v.SetDefault("stripe.price.credits-topup-large", "enx_credits_topup_large")
	// Credit amounts default to 0 (= "not configured"); billing/credit.Consume
	// and GrantSubscription/GrantTopup deliberately reject 0 rather than
	// silently under-crediting, see config.toml's [stripe.credits] comment.
	v.SetDefault("stripe.credits.subscription-pro", 0)
	v.SetDefault("stripe.credits.subscription-pro-plus", 0)
	v.SetDefault("stripe.credits.subscription-max", 0)
	v.SetDefault("stripe.credits.topup-small", 0)
	v.SetDefault("stripe.credits.topup-medium", 0)
	v.SetDefault("stripe.credits.topup-large", 0)
	// Token pricing (ADR-014, ADR-012, ADR-045) defaults to 0 so an
	// unconfigured deployment fails closed; k8s (no config.toml) sets the
	// values via env.
	for _, feature := range []string{"translate", "rephrase", "define-word"} {
		v.SetDefault("stripe.costs."+feature+".weight-in", 0)
		v.SetDefault("stripe.costs."+feature+".weight-out", 0)
		v.SetDefault("stripe.costs."+feature+".divisor", 0)
	}
	// Daily dictionary lookup ceilings per tier (ADR-029). 0 = count but
	// never block, the opposite fail-direction from costs/credits -- see
	// config.toml's [stripe.quota] comment.
	v.SetDefault("stripe.quota.dictionary-lookup-daily-free", 0)
	v.SetDefault("stripe.quota.dictionary-lookup-daily-subscribed", 0)
	// Superseded single-tier key, read as a fallback for -free.
	v.SetDefault("stripe.quota.dictionary-lookup-daily", 0)

	// AI word fallback tuning (ADR-045). Starting guesses, to be tuned from
	// usage: a definition is cached only at or above min-quality (0-10), and
	// the three ceilings are per user.
	v.SetDefault("ai-word.min-quality", 8)
	v.SetDefault("ai-word.calls-per-minute", 6)
	v.SetDefault("ai-word.calls-per-day", 200)
	v.SetDefault("ai-word.cache-writes-per-day", 50)
	v.SetDefault("ai-word.call-timeout", "45s")

	// Sign-up trial (ADR-048): amount 0 switches trials off; the two call
	// ceilings apply only to trial-only users, 0 = no ceiling.
	v.SetDefault("credits.trial.amount", 100)
	v.SetDefault("credits.trial.ttl-days", 7)
	v.SetDefault("credits.trial.calls-per-minute", 5)
	v.SetDefault("credits.trial.calls-per-day", 30)

	// Reading statistics ingest guards (ADR-028 Decision 9). The word cap
	// bounds a single session report; the TTL is how long a deduplication
	// row is kept, which only needs to outlive the client's retry window.
	v.SetDefault("stats.ingest.max-words-per-report", 50000)
	v.SetDefault("stats.ingest.log-ttl-days", 7)

	// Throttle for last_login_time/updated_at writes on every authenticated
	// request (see docs/PERF_FIRST_QUERY_LATENCY.md) — only re-write when the
	// previous value is older than this interval.
	v.SetDefault("user.last-login-update-interval", "5m")
}

// bindEnv binds each key to an explicit environment variable.
//
// Deliberately not calling v.AutomaticEnv(): it makes viper treat ANY
// top-level key segment as shadowed by an identically-named
// (case-insensitive) OS env var, even one nobody meant to bind -- e.g.
// "user.last-login-update-interval" silently resolved to "" instead of its
// "5m" default, because $USER is set in virtually every shell/container.
// TestUserEnvVarDoesNotShadowUserKeys is the regression test.
//
// API keys and secrets are env-only, never written to config.toml.
func bindEnv(v *viper.Viper) {
	for key, env := range envBindings {
		_ = v.BindEnv(key, env)
	}
}

// envBindings maps each config key to its environment variable. Every key a
// containerised deployment needs must be here: the image ships no config.toml.
var envBindings = map[string]string{
	"enx.port":        "ENX_PORT",
	"enx.dev-mode":    "ENX_DEV_MODE",
	"db.path":         "DB_PATH",
	"log.level":       "LOG_LEVEL",
	"metrics.addr":    "METRICS_ADDR",
	"ecdict.db_path":  "ECDICT_DB_PATH",
	"ecdict.sampling": "ECDICT_SAMPLING",

	"resend.api-key":        "RESEND_API_KEY",
	"resend.from":           "RESEND_FROM",
	"resend.admin-to":       "RESEND_ADMIN_TO",
	"app.frontend-base-url": "APP_FRONTEND_BASE_URL",

	// authorized-parties is space-separated, see splitOnWhitespace.
	"clerk.issuer":             "CLERK_ISSUER",
	"clerk.authorized-parties": "CLERK_AUTHORIZED_PARTIES",
	"clerk.jwks-url":           "CLERK_JWKS_URL",
	// Space-separated Clerk user ids allowed to call POST /api/admin/*.
	// Empty => admin endpoints are effectively off.
	"admin.clerk-user-ids": "ADMIN_CLERK_USER_IDS",

	// Sentence translation (TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md
	// §3.5). provider and the per-provider model/base-url are bindable too so
	// k8s can set them without a config file. base-url matters for MiniMax: a
	// platform.minimaxi.com (China) key must hit https://api.minimaxi.com/v1,
	// not https://api.minimax.io/v1, or every call 401s with "invalid api key
	// (2049)".
	"sentence-translate.provider":                  "SENTENCE_TRANSLATE_PROVIDER",
	"sentence-translate.request-timeout":           "SENTENCE_TRANSLATE_REQUEST_TIMEOUT",
	"sentence-translate.kimi.api-key":              "KIMI_API_KEY",
	"sentence-translate.kimi.base-url":             "SENTENCE_TRANSLATE_KIMI_BASE_URL",
	"sentence-translate.kimi.model":                "SENTENCE_TRANSLATE_KIMI_MODEL",
	"sentence-translate.kimi.rephrase-model":       "SENTENCE_TRANSLATE_KIMI_REPHRASE_MODEL",
	"sentence-translate.minimax.api-key":           "MINIMAX_API_KEY",
	"sentence-translate.minimax.base-url":          "SENTENCE_TRANSLATE_MINIMAX_BASE_URL",
	"sentence-translate.minimax.model":             "SENTENCE_TRANSLATE_MINIMAX_MODEL",
	"sentence-translate.minimax.group-id":          "SENTENCE_TRANSLATE_MINIMAX_GROUP_ID",
	"sentence-translate.bedrock.region":            "SENTENCE_TRANSLATE_BEDROCK_REGION",
	"sentence-translate.bedrock.model-id":          "SENTENCE_TRANSLATE_BEDROCK_MODEL_ID",
	"sentence-translate.deepseek.api-key":          "DEEPSEEK_API_KEY",
	"sentence-translate.deepseek.base-url":         "SENTENCE_TRANSLATE_DEEPSEEK_BASE_URL",
	"sentence-translate.deepseek.model":            "SENTENCE_TRANSLATE_DEEPSEEK_MODEL",
	"sentence-translate.deepseek.rephrase-model":   "SENTENCE_TRANSLATE_DEEPSEEK_REPHRASE_MODEL",
	"sentence-translate.gemini.api-key":            "GEMINI_API_KEY",
	"sentence-translate.gemini.base-url":           "SENTENCE_TRANSLATE_GEMINI_BASE_URL",
	"sentence-translate.gemini.model":              "SENTENCE_TRANSLATE_GEMINI_MODEL",
	"sentence-translate.gemini.rephrase-model":     "SENTENCE_TRANSLATE_GEMINI_REPHRASE_MODEL",
	"sentence-translate.openrouter.api-key":        "OPENROUTER_API_KEY",
	"sentence-translate.openrouter.base-url":       "SENTENCE_TRANSLATE_OPENROUTER_BASE_URL",
	"sentence-translate.openrouter.model":          "SENTENCE_TRANSLATE_OPENROUTER_MODEL",
	"sentence-translate.openrouter.rephrase-model": "SENTENCE_TRANSLATE_OPENROUTER_REPHRASE_MODEL",

	"stripe.secret-key":     "STRIPE_SECRET_KEY",
	"stripe.webhook-secret": "STRIPE_WEBHOOK_SECRET",
	// The credit amounts MUST be settable by env: without a binding a
	// containerised deployment was stuck at the 0 default -- a successful
	// subscription granted nothing and every aitranslate request then 502'd.
	"stripe.credits.subscription-pro":      "STRIPE_CREDITS_SUBSCRIPTION_PRO",
	"stripe.credits.subscription-pro-plus": "STRIPE_CREDITS_SUBSCRIPTION_PRO_PLUS",
	"stripe.credits.subscription-max":      "STRIPE_CREDITS_SUBSCRIPTION_MAX",
	"stripe.credits.topup-small":           "STRIPE_CREDITS_TOPUP_SMALL",
	"stripe.credits.topup-medium":          "STRIPE_CREDITS_TOPUP_MEDIUM",
	"stripe.credits.topup-large":           "STRIPE_CREDITS_TOPUP_LARGE",

	"stripe.costs.translate.weight-in":    "STRIPE_COSTS_TRANSLATE_WEIGHT_IN",
	"stripe.costs.translate.weight-out":   "STRIPE_COSTS_TRANSLATE_WEIGHT_OUT",
	"stripe.costs.translate.divisor":      "STRIPE_COSTS_TRANSLATE_DIVISOR",
	"stripe.costs.rephrase.weight-in":     "STRIPE_COSTS_REPHRASE_WEIGHT_IN",
	"stripe.costs.rephrase.weight-out":    "STRIPE_COSTS_REPHRASE_WEIGHT_OUT",
	"stripe.costs.rephrase.divisor":       "STRIPE_COSTS_REPHRASE_DIVISOR",
	"stripe.costs.define-word.weight-in":  "STRIPE_COSTS_DEFINE_WORD_WEIGHT_IN",
	"stripe.costs.define-word.weight-out": "STRIPE_COSTS_DEFINE_WORD_WEIGHT_OUT",
	"stripe.costs.define-word.divisor":    "STRIPE_COSTS_DEFINE_WORD_DIVISOR",

	"stripe.quota.dictionary-lookup-daily-free":       "STRIPE_QUOTA_DICTIONARY_LOOKUP_DAILY_FREE",
	"stripe.quota.dictionary-lookup-daily-subscribed": "STRIPE_QUOTA_DICTIONARY_LOOKUP_DAILY_SUBSCRIBED",

	"ai-word.min-quality":          "AI_WORD_MIN_QUALITY",
	"ai-word.calls-per-minute":     "AI_WORD_CALLS_PER_MINUTE",
	"ai-word.calls-per-day":        "AI_WORD_CALLS_PER_DAY",
	"ai-word.cache-writes-per-day": "AI_WORD_CACHE_WRITES_PER_DAY",
	"ai-word.call-timeout":         "AI_WORD_CALL_TIMEOUT",

	"credits.trial.amount":           "CREDITS_TRIAL_AMOUNT",
	"credits.trial.ttl-days":         "CREDITS_TRIAL_TTL_DAYS",
	"credits.trial.calls-per-minute": "CREDITS_TRIAL_CALLS_PER_MINUTE",
	"credits.trial.calls-per-day":    "CREDITS_TRIAL_CALLS_PER_DAY",

	"stats.ingest.max-words-per-report": "STATS_INGEST_MAX_WORDS_PER_REPORT",
	"stats.ingest.log-ttl-days":         "STATS_INGEST_LOG_TTL_DAYS",

	"user.last-login-update-interval": "USER_LAST_LOGIN_UPDATE_INTERVAL",
}
