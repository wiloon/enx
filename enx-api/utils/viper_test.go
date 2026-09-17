package utils

import (
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestIsTestEnv(t *testing.T) {
	// go test always injects -test.* flags into os.Args.
	if !isTestEnv() {
		t.Error("expected isTestEnv to report true when running under go test")
	}
}

// TestViperInitSetsDefaults exercises ViperInit end to end on the
// pure-defaults path. ViperInit is guarded by sync.Once, so this must be the
// only test in the package that calls it.
func TestViperInitSetsDefaults(t *testing.T) {
	// viperInitInternal searches /usr/local/etc/enx/, $HOME/.enx and "." for
	// config.toml (plus godotenv's ".env" in the working directory). Only the
	// first two can realistically exist here: "go test" runs with the working
	// directory set to utils/, which ships neither file. $HOME/.enx/config.toml
	// however is a developer's *real* personal config, and picking it up made
	// this test fail on their machine while passing in CI. Point HOME at an
	// empty temp dir so the search misses. viper expands "$HOME" when
	// AddConfigPath is called (i.e. inside ViperInit, via os.Getenv("HOME")),
	// so setting it beforehand is enough, and t.Setenv restores it afterwards.
	// /usr/local/etc/enx/config.toml is the one path this can't redirect; the
	// ConfigFileUsed check below turns that into an explicit diagnostic instead
	// of a pile of confusing value mismatches.
	t.Setenv("HOME", t.TempDir())

	// Regression guard: viper.AutomaticEnv() used to be enabled, which made
	// viper treat "user.last-login-update-interval" as shadowed by the
	// ambient $USER env var (present in virtually every shell/container),
	// silently resolving it to "" instead of falling back to its "5m"
	// SetDefault. Setting USER explicitly here reproduces that exact
	// collision regardless of whether the test runner happens to have it
	// set already.
	t.Setenv("USER", "someone")

	ViperInit()

	// Anything below this point assumes no config file won the search; if one
	// did, say so plainly rather than reporting every default as "wrong".
	if used := viper.ConfigFileUsed(); used != "" {
		t.Fatalf("a config file leaked into the defaults-only test: %s", used)
	}

	if got := viper.GetInt("enx.port"); got != 8091 {
		t.Errorf("enx.port = %d, want 8091", got)
	}
	if got := viper.GetBool("enx.dev-mode"); got != false {
		t.Errorf("enx.dev-mode = %v, want false", got)
	}
	if got := viper.GetString("stripe.price.pro"); got != "enx_pro_monthly" {
		t.Errorf("stripe.price.pro = %q, want enx_pro_monthly", got)
	}
	if got := viper.GetInt("stripe.credits.subscription-pro"); got != 0 {
		t.Errorf("stripe.credits.subscription-pro = %d, want 0", got)
	}
	// Rephrase token pricing defaults to 0 (= "not priced"), so an
	// unconfigured deployment 502s the endpoint rather than serving it free.
	if got := viper.GetInt64("stripe.costs.rephrase.weight-in"); got != 0 {
		t.Errorf("stripe.costs.rephrase.weight-in = %d, want 0", got)
	}
	if got := viper.GetInt64("stripe.costs.rephrase.divisor"); got != 0 {
		t.Errorf("stripe.costs.rephrase.divisor = %d, want 0", got)
	}
	if got := viper.GetString("user.last-login-update-interval"); got != "5m" {
		t.Errorf("user.last-login-update-interval = %q, want 5m (see the $USER-collision comment above)", got)
	}
	if got := viper.GetDuration("user.last-login-update-interval"); got != 5*time.Minute {
		t.Errorf("user.last-login-update-interval as duration = %v, want 5m", got)
	}
	if got := viper.GetDuration("sentence-translate.request-timeout"); got != 60*time.Second {
		t.Errorf("sentence-translate.request-timeout = %v, want 60s", got)
	}

	// Calling it again must be a no-op (sync.Once) and must not panic.
	ViperInit()
}
