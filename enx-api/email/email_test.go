package email

import (
	"testing"
	"time"

	"github.com/spf13/viper"
)

// With resend.api-key or resend.admin-to unset, notify must skip the network
// call and return nil — best-effort, optional side effect (ADR-010 Decision 12).
func TestNotifyAdminPageReportSkipsWithoutAPIKey(t *testing.T) {
	viper.Set("resend.api-key", "")
	viper.Set("resend.admin-to", "admin@example.com")
	defer viper.Set("resend.api-key", nil)
	defer viper.Set("resend.admin-to", nil)

	err := NotifyAdminPageReport(PageReportNotify{
		URL: "https://x.com/a/status/1", Host: "x.com", Reason: "no-words",
		Adapter: "x", ExtVersion: "1.0.0", CreatedAt: time.UnixMilli(0).UTC(),
	})
	if err != nil {
		t.Errorf("expected no error when resend.api-key is unset, got %v", err)
	}
}

func TestNotifyAdminPageReportSkipsWithoutAdminTo(t *testing.T) {
	viper.Set("resend.api-key", "re_test")
	viper.Set("resend.admin-to", "")
	defer viper.Set("resend.api-key", nil)
	defer viper.Set("resend.admin-to", nil)

	err := NotifyAdminPageReport(PageReportNotify{
		URL: "https://x.com/a/status/1", Host: "x.com", Reason: "error",
		Adapter: "x", ExtVersion: "1.0.0", CreatedAt: time.Now(),
	})
	if err != nil {
		t.Errorf("expected no error when resend.admin-to is unset, got %v", err)
	}
}
