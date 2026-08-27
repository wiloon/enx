package utils

import (
	"enx-api/utils/logger"
	"flag"
	"os"
	"strings"
	"sync"

	"github.com/joho/godotenv"
	jww "github.com/spf13/jwalterweatherman"
	"github.com/spf13/viper"
)

var viperInitOnce sync.Once

func ViperInit() {
	viperInitOnce.Do(func() {
		viperInitInternal()
	})
}

// isTestEnv checks if we're running under 'go test'
func isTestEnv() bool {
	for _, arg := range os.Args {
		if strings.HasPrefix(arg, "-test.") {
			return true
		}
	}
	return false
}

func viperInitInternal() {
	jww.SetLogThreshold(jww.LevelTrace)
	jww.SetStdoutThreshold(jww.LevelTrace)

	// Set defaults so the app works without any config file
	viper.SetDefault("enx.port", 8091)
	viper.SetDefault("enx.dev-mode", false)

	// Bind each config key to an explicit environment variable
	_ = viper.BindEnv("enx.port", "ENX_PORT")
	_ = viper.BindEnv("enx.dev-mode", "ENX_DEV_MODE")
	_ = viper.BindEnv("redis.address", "REDIS_ADDRESS")
	_ = viper.BindEnv("resend.api-key", "RESEND_API_KEY")
	_ = viper.BindEnv("resend.from", "RESEND_FROM")
	_ = viper.BindEnv("app.frontend-base-url", "APP_FRONTEND_BASE_URL")
	_ = viper.BindEnv("cognito.region", "COGNITO_REGION")
	_ = viper.BindEnv("cognito.user-pool-id", "COGNITO_USER_POOL_ID")
	_ = viper.BindEnv("cognito.client-id", "COGNITO_CLIENT_ID")
	_ = viper.BindEnv("cognito.chrome-client-id", "COGNITO_CHROME_CLIENT_ID")
	_ = viper.BindEnv("cognito.jwks-url", "COGNITO_JWKS_URL")

	viper.SetDefault("cognito.region", "us-east-1")
	viper.SetDefault("resend.api-key", "")
	viper.SetDefault("resend.from", "ENX <no-reply@wiloon.com>")
	viper.SetDefault("app.frontend-base-url", "https://enx-ui.wiloon.lab")

	viper.SetDefault("ecdict.db_path", "")
	_ = viper.BindEnv("ecdict.db_path", "ECDICT_DB_PATH")

	// Sentence translation (AI provider selectable at deploy time, see
	// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.5).
	// provider/model/base-url/region/model-id are non-secret and live in
	// config.toml; API keys are env-var only, never written to config.toml.
	// provider is also bindable via env so k8s deployments (which ship no
	// config.toml, see Containerfile) can select it without a config file.
	viper.SetDefault("sentence-translate.provider", "")
	_ = viper.BindEnv("sentence-translate.provider", "SENTENCE_TRANSLATE_PROVIDER")
	_ = viper.BindEnv("sentence-translate.kimi.api-key", "KIMI_API_KEY")
	_ = viper.BindEnv("sentence-translate.minimax.api-key", "MINIMAX_API_KEY")

	// Stripe billing (see docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md).
	// publishable-key and price lookup_keys are non-secret and live in
	// config.toml; STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are env-var
	// only, never written to config.toml.
	viper.SetDefault("stripe.publishable-key", "")
	// Three subscription tiers (2026-08-26 decision) -- see config.toml's
	// [stripe.price] comment.
	viper.SetDefault("stripe.price.pro", "enx_pro_monthly")
	viper.SetDefault("stripe.price.pro-plus", "enx_pro_plus_monthly")
	viper.SetDefault("stripe.price.max", "enx_max_monthly")
	viper.SetDefault("stripe.price.credits-topup-small", "enx_credits_topup_small")
	viper.SetDefault("stripe.price.credits-topup-medium", "enx_credits_topup_medium")
	viper.SetDefault("stripe.price.credits-topup-large", "enx_credits_topup_large")
	_ = viper.BindEnv("stripe.secret-key", "STRIPE_SECRET_KEY")
	_ = viper.BindEnv("stripe.webhook-secret", "STRIPE_WEBHOOK_SECRET")
	// Credit amounts default to 0 (= "not configured"); billing/credit.Consume
	// and GrantSubscription/GrantTopup deliberately reject 0 rather than
	// silently under-crediting, see config.toml's [stripe.credits] comment.
	viper.SetDefault("stripe.credits.subscription-pro", 0)
	viper.SetDefault("stripe.credits.subscription-pro-plus", 0)
	viper.SetDefault("stripe.credits.subscription-max", 0)
	viper.SetDefault("stripe.credits.topup-small", 0)
	viper.SetDefault("stripe.credits.topup-medium", 0)
	viper.SetDefault("stripe.credits.topup-large", 0)
	// AI call costs default to 0 (= "not configured"); billing/credit.Consume
	// rejects a cost <= 0, see config.toml's [stripe.costs] comment.
	viper.SetDefault("stripe.costs.translate-sentence", 0)
	viper.SetDefault("stripe.costs.translate-word-in-context", 0)
	// Free dictionary lookup quota defaults to 0 (= "unlimited"), the
	// opposite fail-direction from costs/credits -- see config.toml's
	// [stripe.quota] comment.
	viper.SetDefault("stripe.quota.dictionary-lookup-daily", 0)

	// Throttle for last_login_time/updated_at writes on every authenticated
	// request (see docs/PERF_FIRST_QUERY_LATENCY.md) — only re-write when the
	// previous value is older than this interval.
	viper.SetDefault("user.last-login-update-interval", "5m")
	_ = viper.BindEnv("user.last-login-update-interval", "USER_LAST_LOGIN_UPDATE_INTERVAL")

	// NOTE: deliberately not calling viper.AutomaticEnv(). Every env-var
	// override above is bound explicitly via BindEnv, which doesn't need
	// it. AutomaticEnv() makes viper treat ANY top-level key segment as
	// shadowed by an identically-named (case-insensitive) OS env var, even
	// one nobody meant to bind -- e.g. "user.last-login-update-interval"
	// was silently resolving to "" instead of falling back to its "5m"
	// SetDefault, because $USER is set in virtually every shell/container.
	// See utils/viper_test.go's TestViperInitSetsDefaults for the
	// regression test.

	// Load .env file if present (useful for local development)
	if err := godotenv.Load(); err == nil {
		logger.Infof("loaded .env file")
	}

	// Optionally load a TOML config file — not required in k8s
	// In test environment, skip command-line flag parsing to avoid conflicts with testing flags
	configFileValue := ""
	if !isTestEnv() && !flag.Parsed() {
		// Not in test environment, safe to define and parse flags
		configFile := flag.String("c", "", "config file path (e.g., config-e2e.toml)")
		flag.Parse()
		configFileValue = *configFile
	}

	if configFileValue != "" {
		viper.SetConfigFile(configFileValue)
		if err := viper.ReadInConfig(); err != nil {
			logger.Errorf("failed to read config file %s: %v", configFileValue, err)
		} else {
			logger.Infof("loaded config file: %s", viper.ConfigFileUsed())
		}
	} else {
		viper.SetConfigName("config")
		viper.SetConfigType("toml")
		viper.AddConfigPath("/usr/local/etc/enx/")
		viper.AddConfigPath("$HOME/.enx")
		viper.AddConfigPath(".")

		if err := viper.ReadInConfig(); err != nil {
			logger.Infof("no config file found, using environment variables and defaults")
		} else {
			logger.Infof("loaded config file: %s", viper.ConfigFileUsed())
		}
	}
}
