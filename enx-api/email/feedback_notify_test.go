package email

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"enx-api/config"
)

var textFeedback = FeedbackNotify{
	Kind: "text", Text: "line one <script>alert(1)</script>\nline two",
	URL: "https://x.com/a?a=1&b=2", Host: "x.com", UserID: "user_1", RecordID: "fb_1",
	Context:   []byte(`{"adapter":"<x>","extVersion":"1.2.3"}`),
	Details:   []byte(`{"note":"n"}`),
	CreatedAt: time.Date(2026, 11, 5, 8, 30, 0, 0, time.FixedZone("UTC+8", 8*3600)),
}

func okResend(t *testing.T) *fakeResend {
	return newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestNotifyAdminFeedbackMailsTheAdminAnEscapedHTMLRecord(t *testing.T) {
	resend := okResend(t)

	if err := NewSenderAt(alertResend, resend.URL).NotifyAdminFeedback(textFeedback); err != nil {
		t.Fatalf("NotifyAdminFeedback = %v, want nil", err)
	}
	if len(resend.requests) != 1 {
		t.Fatalf("Resend got %d requests, want 1", len(resend.requests))
	}
	if got := resend.requests[0].Header.Get("Authorization"); got != "Bearer re_test" {
		t.Errorf("Authorization = %q, want the API key as bearer", got)
	}
	body := resend.bodies[0]
	if body["from"] != alertResend.From || body["subject"] != "Catglish feedback: text (x.com)" {
		t.Errorf("from/subject = %v / %v", body["from"], body["subject"])
	}
	if to, _ := body["to"].([]any); len(to) != 1 || to[0] != "admin@example.com" {
		t.Errorf("to = %v, want [admin@example.com]", body["to"])
	}
	htmlBody, _ := body["html"].(string)
	for _, want := range []string{
		"text",
		"line one &lt;script&gt;alert(1)&lt;/script&gt;",
		"line two",
		"white-space: pre-wrap",
		"https://x.com/a?a=1&amp;b=2",
		"x.com", "user_1", "fb_1",
		"2026-11-05T00:30:00Z",
		"{\n  &#34;adapter&#34;: &#34;&lt;x&gt;&#34;,\n  &#34;extVersion&#34;: &#34;1.2.3&#34;\n}",
		"{\n  &#34;note&#34;: &#34;n&#34;\n}",
	} {
		if !strings.Contains(htmlBody, want) {
			t.Errorf("html %q lacks %q", htmlBody, want)
		}
	}
	if strings.Contains(htmlBody, "<script>") || strings.Contains(htmlBody, "<x>") {
		t.Errorf("html %q carries user input unescaped", htmlBody)
	}
}

func TestNotifyAdminFeedbackSubjectOmitsAMissingHost(t *testing.T) {
	resend := okResend(t)
	f := textFeedback
	f.Kind, f.Host, f.URL = "definition", "", ""

	if err := NewSenderAt(alertResend, resend.URL).NotifyAdminFeedback(f); err != nil {
		t.Fatalf("NotifyAdminFeedback = %v, want nil", err)
	}
	if len(resend.requests) != 1 || resend.bodies[0]["subject"] != "Catglish feedback: definition" {
		t.Fatalf("requests = %d, bodies = %v, want one with the hostless subject", len(resend.requests), resend.bodies)
	}
}

func TestNotifyAdminFeedbackShowsEmptyOrInvalidJSONAsAnEmptyObject(t *testing.T) {
	cases := map[string]func(*FeedbackNotify){
		"empty context":   func(f *FeedbackNotify) { f.Context = nil },
		"invalid context": func(f *FeedbackNotify) { f.Context = []byte(`{not json`) },
		"empty details":   func(f *FeedbackNotify) { f.Details = []byte{} },
		"invalid details": func(f *FeedbackNotify) { f.Details = []byte(`<b>`) },
	}
	for name, spoil := range cases {
		t.Run(name, func(t *testing.T) {
			resend := okResend(t)
			f := textFeedback
			f.Context, f.Details = []byte(`{"a":1}`), []byte(`{"b":2}`)
			spoil(&f)

			if err := NewSenderAt(alertResend, resend.URL).NotifyAdminFeedback(f); err != nil {
				t.Fatalf("NotifyAdminFeedback = %v, want nil", err)
			}
			if len(resend.requests) != 1 {
				t.Fatalf("Resend got %d requests, want 1", len(resend.requests))
			}
			htmlBody, _ := resend.bodies[0]["html"].(string)
			if !strings.Contains(htmlBody, "<pre>{}</pre>") {
				t.Errorf("html %q lacks the {} fallback", htmlBody)
			}
			if strings.Contains(htmlBody, "not json") || strings.Contains(htmlBody, "&lt;b&gt;") {
				t.Errorf("html %q shows the invalid JSON", htmlBody)
			}
		})
	}
}

func TestNotifyAdminFeedbackReturnsAResendRejection(t *testing.T) {
	resend := newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message":"invalid from"}`))
	})

	err := NewSenderAt(alertResend, resend.URL).NotifyAdminFeedback(textFeedback)
	if err == nil || !strings.Contains(err.Error(), "422") || !strings.Contains(err.Error(), "invalid from") {
		t.Fatalf("err = %v, want the 422 status and Resend's message", err)
	}
}

func TestNotifyAdminFeedbackReturnsATransportFailure(t *testing.T) {
	resend := newFakeResend(t, func(http.ResponseWriter, *http.Request) {})
	resend.Close()

	if err := NewSenderAt(alertResend, resend.URL).NotifyAdminFeedback(textFeedback); err == nil {
		t.Fatal("err = nil, want the failed request")
	}
}

func TestNotifyAdminFeedbackSkipsWithoutAPIKeyOrAdminTo(t *testing.T) {
	cases := map[string]func(*config.Resend){
		"no API key":  func(c *config.Resend) { c.APIKey = "" },
		"no admin-to": func(c *config.Resend) { c.AdminTo = "" },
	}
	for name, unset := range cases {
		t.Run(name, func(t *testing.T) {
			resend := okResend(t)
			cfg := alertResend
			unset(&cfg)

			if err := NewSenderAt(cfg, resend.URL).NotifyAdminFeedback(textFeedback); err != nil {
				t.Errorf("NotifyAdminFeedback = %v, want nil", err)
			}
			if len(resend.requests) != 0 {
				t.Errorf("Resend got %d requests, want none", len(resend.requests))
			}
		})
	}
}
