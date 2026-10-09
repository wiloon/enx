package email

import (
	"testing"
	"time"

	"enx-api/config"
)

// With resend.api-key or resend.admin-to unset, notify must skip the network
// call and return nil — best-effort, optional side effect (ADR-010 Decision 12).
func TestNotifyAdminPageReportSkipsWithoutAPIKey(t *testing.T) {
	sender := NewSender(config.Resend{AdminTo: "admin@example.com"})

	err := sender.NotifyAdminPageReport(PageReportNotify{
		URL: "https://x.com/a/status/1", Host: "x.com", Reason: "no-words",
		Adapter: "x", ExtVersion: "1.0.0", CreatedAt: time.UnixMilli(0).UTC(),
	})
	if err != nil {
		t.Errorf("expected no error when resend.api-key is unset, got %v", err)
	}
}

func TestNotifyAdminPageReportSkipsWithoutAdminTo(t *testing.T) {
	sender := NewSender(config.Resend{APIKey: "re_test"})

	err := sender.NotifyAdminPageReport(PageReportNotify{
		URL: "https://x.com/a/status/1", Host: "x.com", Reason: "error",
		Adapter: "x", ExtVersion: "1.0.0", CreatedAt: time.Now(),
	})
	if err != nil {
		t.Errorf("expected no error when resend.admin-to is unset, got %v", err)
	}
}
