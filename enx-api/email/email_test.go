package email

import (
	"testing"

	"github.com/spf13/viper"
)

// With resend.api-key unset, sendEmail must skip the network call and
// return nil rather than fail -- callers treat email as a best-effort,
// optional side effect (see the "unconfigured but not fatal" pattern used
// throughout this codebase).
func TestSendVerificationEmailSkipsWithoutAPIKey(t *testing.T) {
	viper.Set("resend.api-key", "")
	viper.Set("app.frontend-base-url", "https://example.com")
	defer viper.Set("resend.api-key", nil)
	defer viper.Set("app.frontend-base-url", nil)

	if err := SendVerificationEmail("user@example.com", "wiloon", "tok123"); err != nil {
		t.Errorf("expected no error when resend.api-key is unset, got %v", err)
	}
}

func TestSendPasswordResetEmailSkipsWithoutAPIKey(t *testing.T) {
	viper.Set("resend.api-key", "")
	viper.Set("app.frontend-base-url", "https://example.com")
	defer viper.Set("resend.api-key", nil)
	defer viper.Set("app.frontend-base-url", nil)

	if err := SendPasswordResetEmail("user@example.com", "wiloon", "tok123"); err != nil {
		t.Errorf("expected no error when resend.api-key is unset, got %v", err)
	}
}
