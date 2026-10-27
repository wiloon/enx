// Package config reads enx-api's configuration once, at startup, into a typed
// Config (issue #45). It is the only package that talks to koanf (issue #46,
// ADR-065): everything else receives the sub-struct it needs through its
// constructor.
//
// Sources, lowest precedence first: defaults(), an optional TOML file, then
// the environment variables in envBindings. Production and
// homelab ship no config file, so an env var that is not bound here can never
// reach the app -- TestEveryFieldHasAnEnvVar guards against that.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/joho/godotenv"
	"github.com/knadh/koanf/parsers/toml/v2"
	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/v2"
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
	Account           Account           `mapstructure:"account"`
	SentenceTranslate SentenceTranslate `mapstructure:"sentence-translate"`
	Billing           Billing           `mapstructure:"billing"`
	Stripe            Stripe            `mapstructure:"stripe"`
	AIWord            AIWord            `mapstructure:"ai-word"`
	Credits           Credits           `mapstructure:"credits"`
	RateLimit         RateLimit         `mapstructure:"rate-limit"`
	Stats             Stats             `mapstructure:"stats"`
	User              User              `mapstructure:"user"`
	Ops               Ops               `mapstructure:"ops"`

	// File is the config file that was read, "" when none was.
	File string `mapstructure:"-"`
}

// Secret is a config value that must not reach a log: an API key or a
// signing secret. Printing it (%v, %+v, %#v, %s) or encoding it (JSON, zap)
// shows "[redacted]" when set and "" when empty, so dumping a Config is safe.
// Reveal returns the value itself, for the one place that sends it.
type Secret string

const redacted = "[redacted]"

func (s Secret) Reveal() string { return string(s) }

func (s Secret) String() string {
	if s == "" {
		return ""
	}
	return redacted
}

func (s Secret) GoString() string { return `config.Secret("` + s.String() + `")` }

func (s Secret) MarshalText() ([]byte, error) { return []byte(s.String()), nil }

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
	APIKey  Secret `mapstructure:"api-key"`
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
	// SecretKey is the Clerk Backend API key (ADR-062 Decision 8), used only
	// to delete, ban, unban and sign out users. Empty leaves those actions
	// off (503); everything else works without it. A production issuer
	// requires it (Validate).
	SecretKey Secret `mapstructure:"secret-key"`
}

// clerkDevDomain hosts every Clerk development instance; a production
// instance is served from its own domain (https://clerk.<site domain>).
const clerkDevDomain = "clerk.accounts.dev"

// issuerHostname is the issuer's lower-cased hostname without a port, ""
// when the issuer is empty or has none (no scheme, unparseable).
func (c Clerk) issuerHostname() string {
	u, err := url.Parse(c.Issuer)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// IsProductionInstance reports whether the issuer is a Clerk production
// instance: a hostname outside clerk.accounts.dev. An empty or malformed
// issuer is not production.
func (c Clerk) IsProductionInstance() bool {
	return isProductionHost(c.issuerHostname())
}

// isProductionHost reports whether an issuer hostname, as issuerHostname
// returns it, belongs to a Clerk production instance.
func isProductionHost(host string) bool {
	return host != "" && host != clerkDevDomain && !strings.HasSuffix(host, "."+clerkDevDomain)
}

// validate checks the issuer is a URL and the secret key matches the
// issuer's instance type. Messages never include the key.
func (c Clerk) validate() []error {
	var errs []error
	host := c.issuerHostname()
	if c.Issuer != "" && host == "" {
		errs = append(errs, fmt.Errorf("config: clerk.issuer %q has no hostname; want a URL such as https://clerk.example.com", c.Issuer))
	}

	key := c.SecretKey.Reveal()
	const live, test = "sk_live_", "sk_test_"
	production := isProductionHost(host)
	switch {
	case key == "":
		if production {
			errs = append(errs, errors.New("config: clerk.secret-key (CLERK_SECRET_KEY) is required with a production clerk.issuer"))
		}
	case strings.TrimSpace(key) != key:
		errs = append(errs, errors.New("config: clerk.secret-key has leading or trailing whitespace"))
	case !strings.HasPrefix(key, live) && !strings.HasPrefix(key, test):
		errs = append(errs, errors.New("config: clerk.secret-key does not start with sk_live_ or sk_test_"))
	case key == live || key == test:
		errs = append(errs, errors.New("config: clerk.secret-key has nothing after its prefix"))
	case host == "":
		// No issuer to take an instance type from.
	case production && !strings.HasPrefix(key, live):
		errs = append(errs, errors.New("config: clerk.secret-key is an sk_test_ key but clerk.issuer is a production instance; want sk_live_"))
	case !production && !strings.HasPrefix(key, test):
		errs = append(errs, errors.New("config: clerk.secret-key is an sk_live_ key but clerk.issuer is a development instance; want sk_test_"))
	}
	return errs
}

// Account is account deletion and the trial grant record (ADR-062).
type Account struct {
	// EmailHMACKey keys the HMAC of each email in trial_grants. It must never
	// be rotated once live: every existing record would stop matching.
	EmailHMACKey Secret `mapstructure:"email-hmac-key"`
}

type Admin struct {
	ClerkUserIDs []string `mapstructure:"clerk-user-ids"`
}

// Ops is the operator-facing endpoints outside Clerk (ADR-058 Decision 4).
type Ops struct {
	// StatsToken is the bearer token Grafana presents to
	// GET /api/ops/user-stats/daily. Empty turns the endpoint off (404).
	StatsToken Secret `mapstructure:"stats-token"`
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
	APIKey        Secret `mapstructure:"api-key"`
	BaseURL       string `mapstructure:"base-url"`
	Model         string `mapstructure:"model"`
	RephraseModel string `mapstructure:"rephrase-model"`
}

type MiniMax struct {
	APIKey  Secret `mapstructure:"api-key"`
	BaseURL string `mapstructure:"base-url"`
	Model   string `mapstructure:"model"`
	GroupID string `mapstructure:"group-id"`
}

type Bedrock struct {
	Region  string `mapstructure:"region"`
	ModelID string `mapstructure:"model-id"`
}

type Billing struct {
	Cutover bool `mapstructure:"cutover"`
}

type Stripe struct {
	SecretKey     Secret `mapstructure:"secret-key"`
	WebhookSecret Secret `mapstructure:"webhook-secret"`
	// PortalConfigurationID optionally overrides Stripe's default Portal
	// configuration, the plan-change one. Either choice is checked against
	// ADR-067's plan-change policy before every session.
	PortalConfigurationID string `mapstructure:"portal-configuration-id"`
	// PortalRestrictedConfigurationID optionally overrides the configuration
	// tagged enx_portal=restricted, used for blocked users' sessions (plan
	// switching off, ADR-067).
	PortalRestrictedConfigurationID string        `mapstructure:"portal-restricted-configuration-id"`
	Price                           StripePrice   `mapstructure:"price"`
	Credits                         StripeCredits `mapstructure:"credits"`
	Costs                           StripeCosts   `mapstructure:"costs"`
	Quota                           StripeQuota   `mapstructure:"quota"`
	Webhook                         StripeWebhook `mapstructure:"webhook"`
}

// StripeWebhook is the timing of the durable webhook worker and its admin
// notifications (ADR-067). Each timeout must be shorter than its lease, so a
// claim cannot expire while its own operation may still commit.
type StripeWebhook struct {
	PollInterval     time.Duration `mapstructure:"poll-interval"`
	LeaseDuration    time.Duration `mapstructure:"lease-duration"`
	OperationTimeout time.Duration `mapstructure:"operation-timeout"`
	BackoffMin       time.Duration `mapstructure:"backoff-min"`
	BackoffMax       time.Duration `mapstructure:"backoff-max"`
	// DependencyWaitDeadline runs from an event's first dependency wait;
	// redelivery, restarts and retries never reset it.
	DependencyWaitDeadline    time.Duration `mapstructure:"dependency-wait-deadline"`
	NotificationPollInterval  time.Duration `mapstructure:"notification-poll-interval"`
	NotificationTimeout       time.Duration `mapstructure:"notification-timeout"`
	NotificationLeaseDuration time.Duration `mapstructure:"notification-lease-duration"`
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

// Subscription is the lookup_key for a subscription plan ("pro",
// "pro-plus", "max"); "" for any other plan.
func (p StripePrice) Subscription(plan string) string {
	switch plan {
	case "pro":
		return p.Pro
	case "pro-plus":
		return p.ProPlus
	case "max":
		return p.Max
	}
	return ""
}

// Topup is the lookup_key for a credit top-up tier ("small", "medium",
// "large"); "" for any other tier.
func (p StripePrice) Topup(tier string) string {
	switch tier {
	case "small":
		return p.CreditsTopupSmall
	case "medium":
		return p.CreditsTopupMedium
	case "large":
		return p.CreditsTopupLarge
	}
	return ""
}

// SubscriptionPlans maps each subscription plan to its lookup_key.
func (p StripePrice) SubscriptionPlans() map[string]string {
	return map[string]string{"pro": p.Pro, "pro-plus": p.ProPlus, "max": p.Max}
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

// Subscription is the credits a subscription plan grants per period; 0 for
// an unknown plan, which the ledger rejects like an unconfigured one.
func (c StripeCredits) Subscription(plan string) int64 {
	switch plan {
	case "pro":
		return c.SubscriptionPro
	case "pro-plus":
		return c.SubscriptionProPlus
	case "max":
		return c.SubscriptionMax
	}
	return 0
}

// Topup is the credits a top-up tier grants; 0 for an unknown tier.
func (c StripeCredits) Topup(tier string) int64 {
	switch tier {
	case "small":
		return c.TopupSmall
	case "medium":
		return c.TopupMedium
	case "large":
		return c.TopupLarge
	}
	return 0
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

// StripeQuota is the daily dictionary lookup ceiling per tier (ADR-029,
// ADR-059 Decision 6). Both must be positive: there is no "never block"
// value any more.
type StripeQuota struct {
	DictionaryLookupDailyFree       int64 `mapstructure:"dictionary-lookup-daily-free"`
	DictionaryLookupDailySubscribed int64 `mapstructure:"dictionary-lookup-daily-subscribed"`
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

// RateLimit is the per-user request rate limit on signed-in routes
// (ADR-060): a token bucket refilling RequestsPerSecond, holding Burst.
// RequestsPerSecond 0 switches it off.
type RateLimit struct {
	RequestsPerSecond float64 `mapstructure:"requests-per-second"`
	Burst             int     `mapstructure:"burst"`
}

type Credits struct {
	Trial    Trial    `mapstructure:"trial"`
	Referral Referral `mapstructure:"referral"`
}

// Referral is the invite-link credits (ADR-051 Decision 7). 0 switches the
// matching grant off. The values are estimates, to be calibrated.
type Referral struct {
	// InviteeBonus is added to the invitee's trial pool on top of ADR-048's
	// trial; InviteeTTLDays is how long that trial lasts from sign-up.
	InviteeBonus   int64 `mapstructure:"invitee-bonus"`
	InviteeTTLDays int   `mapstructure:"invitee-ttl-days"`
	// The referrer's reward for the invitee's first payment: a fixed amount
	// for a subscription, a percentage of the credits for a top-up.
	ReferrerRewardSubscription int64 `mapstructure:"referrer-reward-subscription"`
	ReferrerRewardTopupPercent int64 `mapstructure:"referrer-reward-topup-percent"`
	// RewardDelayDays is the cooling-off period before the reward is paid.
	RewardDelayDays int `mapstructure:"reward-delay-days"`
	// ClaimWindowHours is how long after sign-up an invite can be claimed.
	ClaimWindowHours int `mapstructure:"claim-window-hours"`
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
	Ingest       StatsIngest       `mapstructure:"ingest"`
	LookupEvents StatsLookupEvents `mapstructure:"lookup-events"`
}

// Bounds of stats.lookup-events.retention-days (ADR-059 Decision 4). 31:
// WAU and MAU look back 30 days. 100: the privacy policy promises lookup
// events are kept at most 100 days -- change the policy before this.
const (
	MinLookupEventRetentionDays = 31
	MaxLookupEventRetentionDays = 100
)

// StatsLookupEvents is how long lookup events are kept before only their
// daily rollup remains.
type StatsLookupEvents struct {
	RetentionDays int `mapstructure:"retention-days"`
}

// StatsIngest guards reading statistics ingest (ADR-028 Decision 9).
type StatsIngest struct {
	MaxWordsPerReport int64 `mapstructure:"max-words-per-report"`
	LogTTLDays        int   `mapstructure:"log-ttl-days"`
}

// LogTTL is how long a deduplication row is kept.
func (s StatsIngest) LogTTL() time.Duration {
	return time.Duration(s.LogTTLDays) * 24 * time.Hour
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

	k := koanf.New(".")
	if err := k.Load(confmap.Provider(defaults(), "."), nil); err != nil {
		return nil, fmt.Errorf("config: defaults: %w", err)
	}

	file := path
	if file == "" {
		file = searchConfigFile()
	}
	if file != "" {
		m, err := readTOML(file)
		if err != nil {
			return nil, fmt.Errorf("config: read %s: %w", file, err)
		}
		if err := k.Load(confmap.Provider(m, ""), nil); err != nil {
			return nil, fmt.Errorf("config: read %s: %w", file, err)
		}
	}

	if err := k.Load(confmap.Provider(envValues(), "."), nil); err != nil {
		return nil, fmt.Errorf("config: environment: %w", err)
	}

	cfg, err := decode(k)
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	cfg.File = file

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Default is the configuration with nothing but the defaults: no file, no
// environment. Tests start from it and set the fields they care about.
func Default() *Config {
	k := koanf.New(".")
	if err := k.Load(confmap.Provider(defaults(), "."), nil); err != nil {
		panic(fmt.Sprintf("config: defaults do not load: %v", err))
	}
	cfg, err := decode(k)
	if err != nil {
		panic(fmt.Sprintf("config: defaults do not decode: %v", err))
	}
	return cfg
}

// searchDirs are where Load looks for config.toml when no -c is given, first
// match wins.
func searchDirs() []string {
	dirs := []string{"/usr/local/etc/enx"}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".enx"))
	}
	return append(dirs, ".")
}

// searchConfigFile is the absolute path of the first config.toml in
// searchDirs, "" when there is none.
func searchConfigFile() string {
	for _, dir := range searchDirs() {
		p, err := filepath.Abs(filepath.Join(dir, "config.toml"))
		if err != nil {
			continue
		}
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p
		}
	}
	return ""
}

func readTOML(path string) (map[string]any, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return toml.Parser().Unmarshal(b)
}

// envValues is every bound environment variable that is set to something.
// An empty variable counts as unset, so an empty placeholder in a manifest or
// .env does not override the default.
func envValues() map[string]any {
	m := map[string]any{}
	for key, env := range envBindings {
		if v := os.Getenv(env); v != "" {
			m[key] = v
		}
	}
	return m
}

// decode fills a Config from k. Unknown keys are an error, so a typo in
// config.toml stops the process instead of being ignored. Input is weakly
// typed because environment values are all strings ("9001" -> int).
func decode(k *koanf.Koanf) (*Config, error) {
	var cfg Config
	err := k.UnmarshalWithConf("", &cfg, koanf.UnmarshalConf{
		Tag: "mapstructure",
		DecoderConfig: &mapstructure.DecoderConfig{
			DecodeHook: mapstructure.ComposeDecodeHookFunc(
				mapstructure.StringToTimeDurationHookFunc(),
				splitOnWhitespace,
			),
			ErrorUnused:      true,
			WeaklyTypedInput: true,
		},
	})
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// splitOnWhitespace decodes a string into a []string by splitting on
// whitespace. The usual decode hook splits on commas, but the deployments set
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
// default must be positive, and so must both lookup quota ceilings (ADR-059
// Decision 6). Intentional zeros stay valid: Stripe credits and costs at 0
// mean "not configured, fail closed", and the AI word and trial ceilings at
// 0 mean "no ceiling". The Clerk issuer and secret key must agree on the
// instance type (Clerk.validate).
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
	positive("stripe.quota.dictionary-lookup-daily-free", q.DictionaryLookupDailyFree > 0)
	positive("stripe.quota.dictionary-lookup-daily-subscribed", q.DictionaryLookupDailySubscribed > 0)

	wh := c.Stripe.Webhook
	for _, kv := range []struct {
		key string
		d   time.Duration
	}{
		{"poll-interval", wh.PollInterval},
		{"lease-duration", wh.LeaseDuration},
		{"operation-timeout", wh.OperationTimeout},
		{"backoff-min", wh.BackoffMin},
		{"backoff-max", wh.BackoffMax},
		{"dependency-wait-deadline", wh.DependencyWaitDeadline},
		{"notification-poll-interval", wh.NotificationPollInterval},
		{"notification-timeout", wh.NotificationTimeout},
		{"notification-lease-duration", wh.NotificationLeaseDuration},
	} {
		positive("stripe.webhook."+kv.key, kv.d > 0)
	}
	if wh.BackoffMin > wh.BackoffMax {
		errs = append(errs, errors.New("config: stripe.webhook.backoff-min must not exceed stripe.webhook.backoff-max"))
	}
	if wh.OperationTimeout >= wh.LeaseDuration {
		errs = append(errs, errors.New("config: stripe.webhook.operation-timeout must be shorter than stripe.webhook.lease-duration"))
	}
	if wh.NotificationTimeout >= wh.NotificationLeaseDuration {
		errs = append(errs, errors.New("config: stripe.webhook.notification-timeout must be shorter than stripe.webhook.notification-lease-duration"))
	}

	if d := c.Stats.LookupEvents.RetentionDays; d < MinLookupEventRetentionDays || d > MaxLookupEventRetentionDays {
		errs = append(errs, fmt.Errorf("config: stats.lookup-events.retention-days %d is outside %d-%d",
			d, MinLookupEventRetentionDays, MaxLookupEventRetentionDays))
	}

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

	r := c.Credits.Referral
	notNegative("credits.referral.invitee-bonus", r.InviteeBonus >= 0)
	notNegative("credits.referral.invitee-ttl-days", r.InviteeTTLDays >= 0)
	notNegative("credits.referral.referrer-reward-subscription", r.ReferrerRewardSubscription >= 0)
	if p := r.ReferrerRewardTopupPercent; p < 0 || p > 100 {
		errs = append(errs, fmt.Errorf("config: credits.referral.referrer-reward-topup-percent %d is outside 0-100", p))
	}
	notNegative("credits.referral.reward-delay-days", r.RewardDelayDays >= 0)
	notNegative("credits.referral.claim-window-hours", r.ClaimWindowHours >= 0)

	rl := c.RateLimit
	notNegative("rate-limit.requests-per-second", rl.RequestsPerSecond >= 0)
	if rl.RequestsPerSecond > 0 {
		positive("rate-limit.burst", rl.Burst > 0)
	}

	errs = append(errs, c.Clerk.validate()...)

	return errors.Join(errs...)
}

func defaultDBPath() string {
	if runtime.GOOS == "windows" {
		return "C:\\workspace\\apps\\enx\\enx.db"
	}
	return "/var/lib/enx-api/enx.db"
}

// defaults is the single source of truth for defaults: the app works with
// no config file at all.
func defaults() map[string]any {
	d := map[string]any{}
	set := func(key string, value any) { d[key] = value }

	set("enx.port", 8091)
	set("enx.dev-mode", false)
	set("db.path", defaultDBPath())
	// Production ships no config.toml, so this default is what it runs at;
	// the repo's config.toml sets debug for local development.
	set("log.level", "info")
	// ADR-040: the /metrics listener. Loopback by default; homelab (k8s)
	// sets 0.0.0.0:9091 so the in-cluster Prometheus can reach the pod.
	set("metrics.addr", "127.0.0.1:9091")

	set("ecdict.db_path", "")
	// ADR-030 Decision 0: temporary lookup sampling (see the dictsample
	// package). Off by default -- it is measurement scaffolding with an
	// expiry date, and a deploy that forgets to disable it should cost
	// nothing.
	set("ecdict.sampling", false)

	set("resend.api-key", "")
	set("resend.from", "Catglish <no-reply@catglish.com>")
	set("resend.admin-to", "")
	set("app.frontend-base-url", "https://enx.wiloon.lab")

	set("sentence-translate.provider", "")
	// Per-call provider API timeout. 60s: MiniMax's M-series models "think"
	// before the first response byte, so the original hard-coded 10s timed
	// out on rephrase.
	set("sentence-translate.request-timeout", "60s")

	set("billing.cutover", false)

	// Three subscription tiers (2026-08-26 decision) -- see config.toml's
	// [stripe.price] comment.
	set("stripe.price.pro", "enx_pro_monthly")
	set("stripe.price.pro-plus", "enx_pro_plus_monthly")
	set("stripe.price.max", "enx_max_monthly")
	set("stripe.price.credits-topup-small", "enx_credits_topup_small")
	set("stripe.price.credits-topup-medium", "enx_credits_topup_medium")
	set("stripe.price.credits-topup-large", "enx_credits_topup_large")
	// Credit amounts default to 0 (= "not configured"); billing/credit.Consume
	// and GrantSubscription/GrantTopup deliberately reject 0 rather than
	// silently under-crediting, see config.toml's [stripe.credits] comment.
	set("stripe.credits.subscription-pro", 0)
	set("stripe.credits.subscription-pro-plus", 0)
	set("stripe.credits.subscription-max", 0)
	set("stripe.credits.topup-small", 0)
	set("stripe.credits.topup-medium", 0)
	set("stripe.credits.topup-large", 0)
	// Token pricing (ADR-014, ADR-012, ADR-045) defaults to 0 so an
	// unconfigured deployment fails closed; k8s (no config.toml) sets the
	// values via env.
	for _, feature := range []string{"translate", "rephrase", "define-word"} {
		set("stripe.costs."+feature+".weight-in", 0)
		set("stripe.costs."+feature+".weight-out", 0)
		set("stripe.costs."+feature+".divisor", 0)
	}
	// Daily dictionary lookup ceilings per tier (ADR-029, ADR-059 Decision
	// 6): free is the product limit, subscribed a backstop against scripts.
	set("stripe.quota.dictionary-lookup-daily-free", 200)
	set("stripe.quota.dictionary-lookup-daily-subscribed", 20000)
	// Durable webhook worker timing (ADR-067, #297).
	set("stripe.webhook.poll-interval", "5s")
	set("stripe.webhook.lease-duration", "2m")
	set("stripe.webhook.operation-timeout", "30s")
	set("stripe.webhook.backoff-min", "5s")
	set("stripe.webhook.backoff-max", "15m")
	set("stripe.webhook.dependency-wait-deadline", "24h")
	set("stripe.webhook.notification-poll-interval", "1h")
	set("stripe.webhook.notification-timeout", "30s")
	set("stripe.webhook.notification-lease-duration", "2m")

	// AI word fallback tuning (ADR-045). Starting guesses, to be tuned from
	// usage: a definition is cached only at or above min-quality (0-10), and
	// the three ceilings are per user.
	set("ai-word.min-quality", 8)
	set("ai-word.calls-per-minute", 6)
	set("ai-word.calls-per-day", 200)
	set("ai-word.cache-writes-per-day", 50)
	set("ai-word.call-timeout", "45s")

	// Sign-up trial (ADR-048): amount 0 switches trials off; the two call
	// ceilings apply only to trial-only users, 0 = no ceiling.
	set("credits.trial.amount", 100)
	set("credits.trial.ttl-days", 7)
	set("credits.trial.calls-per-minute", 5)
	set("credits.trial.calls-per-day", 30)

	// Referral credits (ADR-051 Decision 7): estimated values, to be
	// calibrated after internal testing. 0 switches each grant off.
	set("credits.referral.invitee-bonus", 100)
	set("credits.referral.invitee-ttl-days", 14)
	set("credits.referral.referrer-reward-subscription", 300)
	set("credits.referral.referrer-reward-topup-percent", 20)
	set("credits.referral.reward-delay-days", 14)
	set("credits.referral.claim-window-hours", 24)

	// Per-user request rate limit (ADR-060 Decision 3). Starting values, to
	// be tuned from enx_rate_limited_total; 0 req/s switches it off.
	set("rate-limit.requests-per-second", 5)
	set("rate-limit.burst", 60)

	// Reading statistics ingest guards (ADR-028 Decision 9). The word cap
	// bounds a single session report; the TTL is how long a deduplication
	// row is kept, which only needs to outlive the client's retry window.
	set("stats.ingest.max-words-per-report", 50000)
	set("stats.ingest.log-ttl-days", 7)
	// Lookup events are kept this many days, then only their daily rollup
	// (ADR-059 Decision 4). Validated against 31-100.
	set("stats.lookup-events.retention-days", 90)

	// Throttle for last_login_time/updated_at writes on every authenticated
	// request (see docs/PERF_FIRST_QUERY_LATENCY.md) — only re-write when the
	// previous value is older than this interval.
	set("user.last-login-update-interval", "5m")

	// Unset: the ops user-stats endpoint is off (ADR-058 Decision 4).
	set("ops.stats-token", "")
	return d
}

// envBindings is the only way an environment variable reaches the config:
// there is no automatic KEY_NAME -> key.name mapping. viper's AutomaticEnv()
// used to shadow ANY top-level key segment with an identically-named OS env
// var, e.g. "user.last-login-update-interval" silently resolved to "" because
// $USER is set in virtually every shell/container.
// TestUserEnvVarDoesNotShadowUserKeys is the regression test.
//
// Every key a containerised deployment needs must be here: the image ships no
// config.toml. API keys and secrets are env-only, never written to
// config.toml.
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
	// Clerk Backend API key (ADR-062): homelab mounts it from the enx-clerk
	// Secret, prod reads it from /opt/enx/enx-api.env.
	"clerk.secret-key": "CLERK_SECRET_KEY",
	// ADR-062 Decision 3: the trial grant record's email HMAC key.
	"account.email-hmac-key": "ACCOUNT_EMAIL_HMAC_KEY",
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

	"billing.cutover": "BILLING_CUTOVER",

	"stripe.secret-key":                         "STRIPE_SECRET_KEY",
	"stripe.webhook-secret":                     "STRIPE_WEBHOOK_SECRET",
	"stripe.portal-configuration-id":            "STRIPE_PORTAL_CONFIGURATION_ID",
	"stripe.portal-restricted-configuration-id": "STRIPE_PORTAL_RESTRICTED_CONFIGURATION_ID",
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

	"stripe.webhook.poll-interval":               "STRIPE_WEBHOOK_POLL_INTERVAL",
	"stripe.webhook.lease-duration":              "STRIPE_WEBHOOK_LEASE_DURATION",
	"stripe.webhook.operation-timeout":           "STRIPE_WEBHOOK_OPERATION_TIMEOUT",
	"stripe.webhook.backoff-min":                 "STRIPE_WEBHOOK_BACKOFF_MIN",
	"stripe.webhook.backoff-max":                 "STRIPE_WEBHOOK_BACKOFF_MAX",
	"stripe.webhook.dependency-wait-deadline":    "STRIPE_WEBHOOK_DEPENDENCY_WAIT_DEADLINE",
	"stripe.webhook.notification-poll-interval":  "STRIPE_WEBHOOK_NOTIFICATION_POLL_INTERVAL",
	"stripe.webhook.notification-timeout":        "STRIPE_WEBHOOK_NOTIFICATION_TIMEOUT",
	"stripe.webhook.notification-lease-duration": "STRIPE_WEBHOOK_NOTIFICATION_LEASE_DURATION",

	"ai-word.min-quality":          "AI_WORD_MIN_QUALITY",
	"ai-word.calls-per-minute":     "AI_WORD_CALLS_PER_MINUTE",
	"ai-word.calls-per-day":        "AI_WORD_CALLS_PER_DAY",
	"ai-word.cache-writes-per-day": "AI_WORD_CACHE_WRITES_PER_DAY",
	"ai-word.call-timeout":         "AI_WORD_CALL_TIMEOUT",

	"credits.trial.amount":           "CREDITS_TRIAL_AMOUNT",
	"credits.trial.ttl-days":         "CREDITS_TRIAL_TTL_DAYS",
	"credits.trial.calls-per-minute": "CREDITS_TRIAL_CALLS_PER_MINUTE",
	"credits.trial.calls-per-day":    "CREDITS_TRIAL_CALLS_PER_DAY",

	"credits.referral.invitee-bonus":                 "CREDITS_REFERRAL_INVITEE_BONUS",
	"credits.referral.invitee-ttl-days":              "CREDITS_REFERRAL_INVITEE_TTL_DAYS",
	"credits.referral.referrer-reward-subscription":  "CREDITS_REFERRAL_REFERRER_REWARD_SUBSCRIPTION",
	"credits.referral.referrer-reward-topup-percent": "CREDITS_REFERRAL_REFERRER_REWARD_TOPUP_PERCENT",
	"credits.referral.reward-delay-days":             "CREDITS_REFERRAL_REWARD_DELAY_DAYS",
	"credits.referral.claim-window-hours":            "CREDITS_REFERRAL_CLAIM_WINDOW_HOURS",

	"rate-limit.requests-per-second": "RATE_LIMIT_REQUESTS_PER_SECOND",
	"rate-limit.burst":               "RATE_LIMIT_BURST",

	"stats.ingest.max-words-per-report":  "STATS_INGEST_MAX_WORDS_PER_REPORT",
	"stats.ingest.log-ttl-days":          "STATS_INGEST_LOG_TTL_DAYS",
	"stats.lookup-events.retention-days": "STATS_LOOKUP_EVENTS_RETENTION_DAYS",

	// Bearer token for GET /api/ops/user-stats/daily (Grafana Infinity).
	"ops.stats-token": "OPS_STATS_TOKEN",

	"user.last-login-update-interval": "USER_LAST_LOGIN_UPDATE_INTERVAL",
}
