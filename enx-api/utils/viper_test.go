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

// TestViperInitSetsDefaults exercises ViperInit end to end. There's no
// config.toml or .env under utils/, so this runs the pure-defaults path.
// ViperInit is guarded by sync.Once, so this must be the only test in the
// package that calls it.
func TestViperInitSetsDefaults(t *testing.T) {
	// Regression guard: viper.AutomaticEnv() used to be enabled, which made
	// viper treat "user.last-login-update-interval" as shadowed by the
	// ambient $USER env var (present in virtually every shell/container),
	// silently resolving it to "" instead of falling back to its "5m"
	// SetDefault. Setting USER explicitly here reproduces that exact
	// collision regardless of whether the test runner happens to have it
	// set already.
	t.Setenv("USER", "someone")

	ViperInit()

	if got := viper.GetInt("enx.port"); got != 8091 {
		t.Errorf("enx.port = %d, want 8091", got)
	}
	if got := viper.GetBool("enx.dev-mode"); got != false {
		t.Errorf("enx.dev-mode = %v, want false", got)
	}
	if got := viper.GetString("cognito.region"); got != "us-east-1" {
		t.Errorf("cognito.region = %q, want us-east-1", got)
	}
	if got := viper.GetString("stripe.price.pro"); got != "enx_pro_monthly" {
		t.Errorf("stripe.price.pro = %q, want enx_pro_monthly", got)
	}
	if got := viper.GetInt("stripe.credits.subscription-pro"); got != 0 {
		t.Errorf("stripe.credits.subscription-pro = %d, want 0", got)
	}
	if got := viper.GetString("user.last-login-update-interval"); got != "5m" {
		t.Errorf("user.last-login-update-interval = %q, want 5m (see the $USER-collision comment above)", got)
	}
	if got := viper.GetDuration("user.last-login-update-interval"); got != 5*time.Minute {
		t.Errorf("user.last-login-update-interval as duration = %v, want 5m", got)
	}

	// Calling it again must be a no-op (sync.Once) and must not panic.
	ViperInit()
}
