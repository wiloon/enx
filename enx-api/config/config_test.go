package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// isolate keeps Load from finding a real config file or .env: it searches the
// working directory and $HOME/.enx, and a developer's personal
// $HOME/.enx/config.toml must not leak into the tests. It also clears every
// bound env var, so a value exported in the developer's shell (say
// ENX_DEV_MODE=true) cannot change a result. /usr/local/etc/enx/ is the one
// search path this cannot redirect; loadDefaults turns a hit there into an
// explicit failure.
func isolate(t *testing.T) {
	t.Helper()
	t.Chdir(t.TempDir())
	t.Setenv("HOME", t.TempDir())
	for _, env := range envBindings {
		t.Setenv(env, "")
		os.Unsetenv(env)
	}
}

func loadDefaults(t *testing.T) *Config {
	t.Helper()
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.File != "" {
		t.Fatalf("a config file leaked into the defaults-only test: %s", cfg.File)
	}
	return cfg
}

func writeTOML(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadDefaults(t *testing.T) {
	isolate(t)
	cfg := loadDefaults(t)

	checks := []struct {
		name      string
		got, want any
	}{
		{"enx.port", cfg.Enx.Port, 8091},
		{"enx.dev-mode", cfg.Enx.DevMode, false},
		{"db.path", cfg.DB.Path, defaultDBPath()},
		// Production has no config.toml: without LOG_LEVEL it must not log at debug.
		{"log.level", cfg.Log.Level, "info"},
		{"metrics.addr", cfg.Metrics.Addr, "127.0.0.1:9091"},
		{"ecdict.sampling", cfg.Ecdict.Sampling, false},
		{"resend.from", cfg.Resend.From, "Catglish <no-reply@catglish.com>"},
		{"app.frontend-base-url", cfg.App.FrontendBaseURL, "https://enx.wiloon.lab"},
		{"sentence-translate.request-timeout", cfg.SentenceTranslate.RequestTimeout, 60 * time.Second},
		{"stripe.price.pro", cfg.Stripe.Price.Pro, "enx_pro_monthly"},
		{"stripe.price.credits-topup-large", cfg.Stripe.Price.CreditsTopupLarge, "enx_credits_topup_large"},
		// Unpriced and unconfigured by default: the features fail closed.
		{"stripe.credits.subscription-pro", cfg.Stripe.Credits.SubscriptionPro, int64(0)},
		{"stripe.costs.rephrase.divisor", cfg.Stripe.Costs.Rephrase.Divisor, int64(0)},
		{"stripe.quota.dictionary-lookup-daily-free", cfg.Stripe.Quota.DictionaryLookupDailyFree, int64(0)},
		{"ai-word.min-quality", cfg.AIWord.MinQuality, 8},
		{"ai-word.call-timeout", cfg.AIWord.CallTimeout, 45 * time.Second},
		{"credits.trial.amount", cfg.Credits.Trial.Amount, int64(100)},
		{"credits.trial.ttl-days", cfg.Credits.Trial.TTLDays, 7},
		{"credits.trial.calls-per-day", cfg.Credits.Trial.CallsPerDay, 30},
		{"stats.ingest.max-words-per-report", cfg.Stats.Ingest.MaxWordsPerReport, int64(50000)},
		{"stats.ingest.log-ttl-days", cfg.Stats.Ingest.LogTTLDays, 7},
		{"user.last-login-update-interval", cfg.User.LastLoginUpdateInterval, 5 * time.Minute},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
}

func TestDefaultMatchesLoadWithNothingSet(t *testing.T) {
	isolate(t)
	if got, want := Default(), loadDefaults(t); !reflect.DeepEqual(got, want) {
		t.Errorf("Default() = %+v\nLoad(\"\") = %+v", got, want)
	}
	if err := Default().Validate(); err != nil {
		t.Errorf("Default().Validate() = %v", err)
	}
}

// Regression guard: viper.AutomaticEnv() used to be enabled, which made
// "user.last-login-update-interval" resolve to $USER's shadow ("") instead of
// its "5m" default.
func TestUserEnvVarDoesNotShadowUserKeys(t *testing.T) {
	isolate(t)
	t.Setenv("USER", "someone")

	if got := loadDefaults(t).User.LastLoginUpdateInterval; got != 5*time.Minute {
		t.Errorf("user.last-login-update-interval = %v, want 5m", got)
	}
}

// envVars is every environment variable the app reads, copied from the
// BindEnv calls in utils/viper.go plus DB_PATH (read by sqlitex before #45).
// Deliberately not derived from envBindings: dropping a binding there must
// fail this test.
var envVars = map[string]string{
	"ENX_PORT":                                        "enx.port",
	"ENX_DEV_MODE":                                    "enx.dev-mode",
	"DB_PATH":                                         "db.path",
	"LOG_LEVEL":                                       "log.level",
	"METRICS_ADDR":                                    "metrics.addr",
	"ECDICT_DB_PATH":                                  "ecdict.db_path",
	"ECDICT_SAMPLING":                                 "ecdict.sampling",
	"RESEND_API_KEY":                                  "resend.api-key",
	"RESEND_FROM":                                     "resend.from",
	"RESEND_ADMIN_TO":                                 "resend.admin-to",
	"APP_FRONTEND_BASE_URL":                           "app.frontend-base-url",
	"CLERK_ISSUER":                                    "clerk.issuer",
	"CLERK_AUTHORIZED_PARTIES":                        "clerk.authorized-parties",
	"CLERK_JWKS_URL":                                  "clerk.jwks-url",
	"ADMIN_CLERK_USER_IDS":                            "admin.clerk-user-ids",
	"SENTENCE_TRANSLATE_PROVIDER":                     "sentence-translate.provider",
	"SENTENCE_TRANSLATE_REQUEST_TIMEOUT":              "sentence-translate.request-timeout",
	"KIMI_API_KEY":                                    "sentence-translate.kimi.api-key",
	"SENTENCE_TRANSLATE_KIMI_BASE_URL":                "sentence-translate.kimi.base-url",
	"SENTENCE_TRANSLATE_KIMI_MODEL":                   "sentence-translate.kimi.model",
	"SENTENCE_TRANSLATE_KIMI_REPHRASE_MODEL":          "sentence-translate.kimi.rephrase-model",
	"MINIMAX_API_KEY":                                 "sentence-translate.minimax.api-key",
	"SENTENCE_TRANSLATE_MINIMAX_BASE_URL":             "sentence-translate.minimax.base-url",
	"SENTENCE_TRANSLATE_MINIMAX_MODEL":                "sentence-translate.minimax.model",
	"SENTENCE_TRANSLATE_MINIMAX_GROUP_ID":             "sentence-translate.minimax.group-id",
	"SENTENCE_TRANSLATE_BEDROCK_REGION":               "sentence-translate.bedrock.region",
	"SENTENCE_TRANSLATE_BEDROCK_MODEL_ID":             "sentence-translate.bedrock.model-id",
	"DEEPSEEK_API_KEY":                                "sentence-translate.deepseek.api-key",
	"SENTENCE_TRANSLATE_DEEPSEEK_BASE_URL":            "sentence-translate.deepseek.base-url",
	"SENTENCE_TRANSLATE_DEEPSEEK_MODEL":               "sentence-translate.deepseek.model",
	"SENTENCE_TRANSLATE_DEEPSEEK_REPHRASE_MODEL":      "sentence-translate.deepseek.rephrase-model",
	"GEMINI_API_KEY":                                  "sentence-translate.gemini.api-key",
	"SENTENCE_TRANSLATE_GEMINI_BASE_URL":              "sentence-translate.gemini.base-url",
	"SENTENCE_TRANSLATE_GEMINI_MODEL":                 "sentence-translate.gemini.model",
	"SENTENCE_TRANSLATE_GEMINI_REPHRASE_MODEL":        "sentence-translate.gemini.rephrase-model",
	"OPENROUTER_API_KEY":                              "sentence-translate.openrouter.api-key",
	"SENTENCE_TRANSLATE_OPENROUTER_BASE_URL":          "sentence-translate.openrouter.base-url",
	"SENTENCE_TRANSLATE_OPENROUTER_MODEL":             "sentence-translate.openrouter.model",
	"SENTENCE_TRANSLATE_OPENROUTER_REPHRASE_MODEL":    "sentence-translate.openrouter.rephrase-model",
	"STRIPE_SECRET_KEY":                               "stripe.secret-key",
	"STRIPE_WEBHOOK_SECRET":                           "stripe.webhook-secret",
	"STRIPE_CREDITS_SUBSCRIPTION_PRO":                 "stripe.credits.subscription-pro",
	"STRIPE_CREDITS_SUBSCRIPTION_PRO_PLUS":            "stripe.credits.subscription-pro-plus",
	"STRIPE_CREDITS_SUBSCRIPTION_MAX":                 "stripe.credits.subscription-max",
	"STRIPE_CREDITS_TOPUP_SMALL":                      "stripe.credits.topup-small",
	"STRIPE_CREDITS_TOPUP_MEDIUM":                     "stripe.credits.topup-medium",
	"STRIPE_CREDITS_TOPUP_LARGE":                      "stripe.credits.topup-large",
	"STRIPE_COSTS_TRANSLATE_WEIGHT_IN":                "stripe.costs.translate.weight-in",
	"STRIPE_COSTS_TRANSLATE_WEIGHT_OUT":               "stripe.costs.translate.weight-out",
	"STRIPE_COSTS_TRANSLATE_DIVISOR":                  "stripe.costs.translate.divisor",
	"STRIPE_COSTS_REPHRASE_WEIGHT_IN":                 "stripe.costs.rephrase.weight-in",
	"STRIPE_COSTS_REPHRASE_WEIGHT_OUT":                "stripe.costs.rephrase.weight-out",
	"STRIPE_COSTS_REPHRASE_DIVISOR":                   "stripe.costs.rephrase.divisor",
	"STRIPE_COSTS_DEFINE_WORD_WEIGHT_IN":              "stripe.costs.define-word.weight-in",
	"STRIPE_COSTS_DEFINE_WORD_WEIGHT_OUT":             "stripe.costs.define-word.weight-out",
	"STRIPE_COSTS_DEFINE_WORD_DIVISOR":                "stripe.costs.define-word.divisor",
	"STRIPE_QUOTA_DICTIONARY_LOOKUP_DAILY_FREE":       "stripe.quota.dictionary-lookup-daily-free",
	"STRIPE_QUOTA_DICTIONARY_LOOKUP_DAILY_SUBSCRIBED": "stripe.quota.dictionary-lookup-daily-subscribed",
	"AI_WORD_MIN_QUALITY":                             "ai-word.min-quality",
	"AI_WORD_CALLS_PER_MINUTE":                        "ai-word.calls-per-minute",
	"AI_WORD_CALLS_PER_DAY":                           "ai-word.calls-per-day",
	"AI_WORD_CACHE_WRITES_PER_DAY":                    "ai-word.cache-writes-per-day",
	"AI_WORD_CALL_TIMEOUT":                            "ai-word.call-timeout",
	"CREDITS_TRIAL_AMOUNT":                            "credits.trial.amount",
	"CREDITS_TRIAL_TTL_DAYS":                          "credits.trial.ttl-days",
	"CREDITS_TRIAL_CALLS_PER_MINUTE":                  "credits.trial.calls-per-minute",
	"CREDITS_TRIAL_CALLS_PER_DAY":                     "credits.trial.calls-per-day",
	"STATS_INGEST_MAX_WORDS_PER_REPORT":               "stats.ingest.max-words-per-report",
	"STATS_INGEST_LOG_TTL_DAYS":                       "stats.ingest.log-ttl-days",
	"USER_LAST_LOGIN_UPDATE_INTERVAL":                 "user.last-login-update-interval",
}

// TestEnvVarsPopulateTheirFields sets each env var to a value no default has
// and checks it reaches its field. ENX_PORT is the one int value with a range
// rule; 7 is a valid port.
func TestEnvVarsPopulateTheirFields(t *testing.T) {
	for env, key := range envVars {
		t.Run(env, func(t *testing.T) {
			isolate(t)
			field := fieldByKey(t, reflect.TypeOf(Config{}), key)

			var value string
			var want any
			switch field.Type {
			case reflect.TypeOf(""):
				value, want = "from-"+env, "from-"+env
			case reflect.TypeOf(0), reflect.TypeOf(int64(0)):
				value = "7"
				want = reflect.ValueOf(7).Convert(field.Type).Interface()
			case reflect.TypeOf(false):
				value, want = "true", true
			case reflect.TypeOf(time.Duration(0)):
				value, want = "7s", 7*time.Second
			case reflect.TypeOf([]string{}):
				value, want = "a b", []string{"a", "b"}
			default:
				t.Fatalf("no test value for %s (%s)", key, field.Type)
			}
			t.Setenv(env, value)

			cfg := loadDefaults(t)
			got := valueByKey(t, reflect.ValueOf(*cfg), key).Interface()
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s=%q: %s = %#v, want %#v", env, value, key, got, want)
			}
		})
	}
}

// fileOnlyKeys are the fields that deliberately have no env var.
var fileOnlyKeys = map[string]bool{
	// Stripe lookup_keys are the same in every deployment; the defaults suffice.
	"stripe.price.pro":                  true,
	"stripe.price.pro-plus":             true,
	"stripe.price.max":                  true,
	"stripe.price.credits-topup-small":  true,
	"stripe.price.credits-topup-medium": true,
	"stripe.price.credits-topup-large":  true,
	// Superseded key, kept only as a fallback for config files.
	"stripe.quota.dictionary-lookup-daily": true,
}

// TestEveryFieldHasAnEnvVar: the image ships no config.toml, so a field with
// no env var is stuck at its default in k8s -- the stripe.credits.* incident.
// A new field needs a binding in envBindings (and a row in envVars), or an
// entry in fileOnlyKeys saying why not.
func TestEveryFieldHasAnEnvVar(t *testing.T) {
	bound := map[string]bool{}
	for _, key := range envVars {
		bound[key] = true
	}
	for _, key := range leafKeys(reflect.TypeOf(Config{}), "") {
		if !bound[key] && !fileOnlyKeys[key] {
			t.Errorf("%s has no environment variable", key)
		}
	}
}

// TestListEnvVarsSplitOnWhitespace: both deployments set these
// space-separated. Split on commas (viper's default), Clerk would reject every
// signed-in request's azp (401).
func TestListEnvVarsSplitOnWhitespace(t *testing.T) {
	isolate(t)
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "https://enx.wiloon.lab  chrome-extension://abc")
	t.Setenv("ADMIN_CLERK_USER_IDS", "user_1 user_2")

	cfg := loadDefaults(t)
	if got, want := cfg.Clerk.AuthorizedParties, []string{"https://enx.wiloon.lab", "chrome-extension://abc"}; !reflect.DeepEqual(got, want) {
		t.Errorf("clerk.authorized-parties = %q, want %q", got, want)
	}
	if got, want := cfg.Admin.ClerkUserIDs, []string{"user_1", "user_2"}; !reflect.DeepEqual(got, want) {
		t.Errorf("admin.clerk-user-ids = %q, want %q", got, want)
	}
}

func TestListInTOMLIsAnArray(t *testing.T) {
	isolate(t)
	path := writeTOML(t, `[clerk]
authorized-parties = ["https://a.example", "https://b.example"]
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got, want := cfg.Clerk.AuthorizedParties, []string{"https://a.example", "https://b.example"}; !reflect.DeepEqual(got, want) {
		t.Errorf("clerk.authorized-parties = %q, want %q", got, want)
	}
}

func TestEnvOverridesFile(t *testing.T) {
	isolate(t)
	path := writeTOML(t, "[enx]\nport = 9000\n")
	t.Setenv("ENX_PORT", "9001")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Enx.Port != 9001 {
		t.Errorf("enx.port = %d, want 9001 (env beats file)", cfg.Enx.Port)
	}
	if cfg.File != path {
		t.Errorf("File = %q, want %q", cfg.File, path)
	}
}

// The repo's own config.toml must load: it is what `task dev` and the
// enx-chrome e2e run with.
func TestRepoConfigTOMLLoads(t *testing.T) {
	repoConfig, err := filepath.Abs("../config.toml")
	if err != nil {
		t.Fatal(err)
	}
	isolate(t)
	if _, err := Load(repoConfig); err != nil {
		t.Fatalf("Load(config.toml): %v", err)
	}
}

func TestLoadSearchFindsConfigInWorkingDirectory(t *testing.T) {
	isolate(t)
	if err := os.WriteFile("config.toml", []byte("[enx]\nport = 9002\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Enx.Port != 9002 {
		t.Errorf("enx.port = %d, want 9002", cfg.Enx.Port)
	}
}

func TestLoadRejects(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		toml    string
		wantErr string
	}{
		{
			name:    "unknown key in the config file",
			toml:    "[enx]\nprot = 8091\n",
			wantErr: "prot",
		},
		{
			name:    "unknown section in the config file",
			toml:    "[mysql]\naddress = \"db:3306\"\n",
			wantErr: "mysql",
		},
		{
			name:    "key from another provider's shape",
			toml:    "[sentence-translate.kimi]\ngroup-id = \"g\"\n",
			wantErr: "group-id",
		},
		{
			name:    "malformed duration",
			env:     map[string]string{"SENTENCE_TRANSLATE_REQUEST_TIMEOUT": "abc"},
			wantErr: "request-timeout",
		},
		{
			name:    "malformed number",
			env:     map[string]string{"STRIPE_CREDITS_TOPUP_SMALL": "lots"},
			wantErr: "topup-small",
		},
		{
			name:    "zero request timeout",
			env:     map[string]string{"SENTENCE_TRANSLATE_REQUEST_TIMEOUT": "0s"},
			wantErr: "sentence-translate.request-timeout must be positive",
		},
		{
			name:    "zero max words per report",
			env:     map[string]string{"STATS_INGEST_MAX_WORDS_PER_REPORT": "0"},
			wantErr: "stats.ingest.max-words-per-report must be positive",
		},
		{
			name:    "zero ingest log TTL",
			env:     map[string]string{"STATS_INGEST_LOG_TTL_DAYS": "0"},
			wantErr: "stats.ingest.log-ttl-days must be positive",
		},
		{
			name:    "zero last-login update interval",
			env:     map[string]string{"USER_LAST_LOGIN_UPDATE_INTERVAL": "0s"},
			wantErr: "user.last-login-update-interval must be positive",
		},
		{
			name:    "negative last-login update interval",
			env:     map[string]string{"USER_LAST_LOGIN_UPDATE_INTERVAL": "-5m"},
			wantErr: "user.last-login-update-interval must be positive",
		},
		{
			name:    "negative credit grant",
			env:     map[string]string{"STRIPE_CREDITS_SUBSCRIPTION_MAX": "-1"},
			wantErr: "stripe.credits.subscription-max must not be negative",
		},
		{
			name:    "negative token price",
			env:     map[string]string{"STRIPE_COSTS_DEFINE_WORD_DIVISOR": "-3000"},
			wantErr: "stripe.costs.define-word.divisor must not be negative",
		},
		{
			name:    "negative AI word call timeout",
			env:     map[string]string{"AI_WORD_CALL_TIMEOUT": "-1s"},
			wantErr: "ai-word.call-timeout must not be negative",
		},
		{
			name:    "AI word quality above 10",
			env:     map[string]string{"AI_WORD_MIN_QUALITY": "11"},
			wantErr: "ai-word.min-quality",
		},
		{
			name:    "port out of range",
			env:     map[string]string{"ENX_PORT": "70000"},
			wantErr: "enx.port",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			isolate(t)
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			path := ""
			if c.toml != "" {
				path = writeTOML(t, c.toml)
			}
			_, err := Load(path)
			if err == nil {
				t.Fatalf("Load succeeded, want an error mentioning %q", c.wantErr)
			}
			if !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("error = %v, want it to mention %q", err, c.wantErr)
			}
		})
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	isolate(t)
	t.Setenv("STATS_INGEST_LOG_TTL_DAYS", "0")
	t.Setenv("CREDITS_TRIAL_AMOUNT", "-1")

	_, err := Load("")
	if err == nil {
		t.Fatal("Load succeeded, want an error")
	}
	for _, want := range []string{"stats.ingest.log-ttl-days", "credits.trial.amount"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %v, want it to mention %s", err, want)
		}
	}
}

func TestLoadMissingExplicitFileFails(t *testing.T) {
	isolate(t)
	if _, err := Load(filepath.Join(t.TempDir(), "nope.toml")); err == nil {
		t.Fatal("Load succeeded for a missing -c file, want an error")
	}
}

func TestLoadUnparseableSearchedFileFails(t *testing.T) {
	isolate(t)
	if err := os.WriteFile("config.toml", []byte("[enx\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(""); err == nil {
		t.Fatal("Load succeeded for a broken config.toml, want an error")
	}
}

// Zeros that mean something must still load: Stripe credits and costs at 0
// are "not configured, fail closed", quotas at 0 are "count but never block",
// and 0 switches the trial and the AI word ceilings off.
func TestLoadAcceptsIntentionalZeros(t *testing.T) {
	isolate(t)
	for env, key := range envVars {
		if strings.HasPrefix(key, "stripe.credits.") || strings.HasPrefix(key, "stripe.costs.") ||
			strings.HasPrefix(key, "stripe.quota.") || strings.HasPrefix(key, "credits.trial.") ||
			strings.HasPrefix(key, "ai-word.") {
			t.Setenv(env, "0")
		}
	}
	if _, err := Load(""); err != nil {
		t.Fatalf("Load: %v", err)
	}
}

func TestFreeDailyLookupLimit(t *testing.T) {
	cases := []struct {
		name       string
		quota      StripeQuota
		wantLimit  int64
		wantLegacy bool
	}{
		{"free key set", StripeQuota{DictionaryLookupDailyFree: 200, DictionaryLookupDaily: 50}, 200, false},
		{"only the superseded key", StripeQuota{DictionaryLookupDaily: 50}, 50, true},
		{"neither: never block", StripeQuota{}, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			limit, legacy := c.quota.FreeDailyLookupLimit()
			if limit != c.wantLimit || legacy != c.wantLegacy {
				t.Errorf("FreeDailyLookupLimit() = (%d, %v), want (%d, %v)", limit, legacy, c.wantLimit, c.wantLegacy)
			}
		})
	}
}

func TestLegacyQuotaKeyLoadsFromFile(t *testing.T) {
	isolate(t)
	path := writeTOML(t, "[stripe.quota]\ndictionary-lookup-daily = 50\n")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if limit, legacy := cfg.Stripe.Quota.FreeDailyLookupLimit(); limit != 50 || !legacy {
		t.Errorf("FreeDailyLookupLimit() = (%d, %v), want (50, true)", limit, legacy)
	}
}

// leafKeys lists the dotted config key of every non-struct field.
func leafKeys(typ reflect.Type, prefix string) []string {
	var keys []string
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		tag := f.Tag.Get("mapstructure")
		if tag == "" || tag == "-" {
			continue
		}
		key := prefix + tag
		if f.Type.Kind() == reflect.Struct && f.Type != reflect.TypeOf(time.Duration(0)) {
			keys = append(keys, leafKeys(f.Type, key+".")...)
		} else {
			keys = append(keys, key)
		}
	}
	return keys
}

func fieldByKey(t *testing.T, typ reflect.Type, key string) reflect.StructField {
	t.Helper()
	var field reflect.StructField
	for _, part := range strings.Split(key, ".") {
		found := false
		for i := 0; i < typ.NumField(); i++ {
			if typ.Field(i).Tag.Get("mapstructure") == part {
				field, typ, found = typ.Field(i), typ.Field(i).Type, true
				break
			}
		}
		if !found {
			t.Fatalf("Config has no field for key %s", key)
		}
	}
	return field
}

func valueByKey(t *testing.T, v reflect.Value, key string) reflect.Value {
	t.Helper()
	for _, part := range strings.Split(key, ".") {
		found := false
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).Tag.Get("mapstructure") == part {
				v, found = v.Field(i), true
				break
			}
		}
		if !found {
			t.Fatalf("Config has no field for key %s", key)
		}
	}
	return v
}

func TestStatsIngestLogTTL(t *testing.T) {
	if got := (StatsIngest{LogTTLDays: 7}).LogTTL(); got != 7*24*time.Hour {
		t.Errorf("LogTTL() = %v, want 168h", got)
	}
}
