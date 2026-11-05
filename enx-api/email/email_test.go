package email

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"enx-api/config"
)

var pageReport = PageReportNotify{
	URL: "https://x.com/a/status/1?a=1&b=2", Host: "x.com", Reason: "no-words",
	Adapter: "<x>", ExtVersion: "1.2.3", CreatedAt: time.Date(2026, 11, 5, 8, 30, 0, 0, time.FixedZone("UTC+8", 8*3600)),
}

func TestNotifyAdminPageReportMailsTheAdminAnEscapedHTMLReport(t *testing.T) {
	resend := newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	if err := alertSender(alertResend, resend.URL).NotifyAdminPageReport(pageReport); err != nil {
		t.Fatalf("NotifyAdminPageReport = %v, want nil", err)
	}
	if len(resend.requests) != 1 {
		t.Fatalf("Resend got %d requests, want 1", len(resend.requests))
	}
	if got := resend.requests[0].Header.Get("Authorization"); got != "Bearer re_test" {
		t.Errorf("Authorization = %q, want the API key as bearer", got)
	}
	body := resend.bodies[0]
	if body["from"] != alertResend.From || body["subject"] != "Catglish page report: x.com (no-words)" {
		t.Errorf("from/subject = %v / %v", body["from"], body["subject"])
	}
	if to, _ := body["to"].([]any); len(to) != 1 || to[0] != "admin@example.com" {
		t.Errorf("to = %v, want [admin@example.com]", body["to"])
	}
	htmlBody, _ := body["html"].(string)
	for _, want := range []string{"a=1&amp;b=2", "&lt;x&gt;", "1.2.3", "2026-11-05T00:30:00Z"} {
		if !strings.Contains(htmlBody, want) {
			t.Errorf("html %q lacks %q", htmlBody, want)
		}
	}
	if strings.Contains(htmlBody, "<x>") {
		t.Errorf("html %q carries the adapter unescaped", htmlBody)
	}
}

func TestNotifyAdminPageReportReturnsAResendRejection(t *testing.T) {
	resend := newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message":"invalid from"}`))
	})

	err := alertSender(alertResend, resend.URL).NotifyAdminPageReport(pageReport)
	if err == nil || !strings.Contains(err.Error(), "422") || !strings.Contains(err.Error(), "invalid from") {
		t.Fatalf("err = %v, want the 422 status and Resend's message", err)
	}
}

func TestNotifyAdminPageReportReturnsATransportFailure(t *testing.T) {
	resend := newFakeResend(t, func(http.ResponseWriter, *http.Request) {})
	resend.Close()

	if err := alertSender(alertResend, resend.URL).NotifyAdminPageReport(pageReport); err == nil {
		t.Fatal("err = nil, want the failed request")
	}
}

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
