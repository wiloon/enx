package adapters

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/email"
	"enx-api/feedback"
)

type fakeResend struct {
	*httptest.Server
	bodies []map[string]any
}

func newFakeResend(t *testing.T) *fakeResend {
	t.Helper()
	f := &fakeResend{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		f.bodies = append(f.bodies, body)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(f.Close)
	return f
}

func mailTo(resend *fakeResend) Mail {
	cfg := config.Resend{APIKey: "re_test", From: "Catglish <no-reply@catglish.com>", AdminTo: "admin@example.com"}
	return Mail{Sender: email.NewSenderAt(cfg, resend.URL)}
}

func record(kind feedback.Kind) feedback.Record {
	return feedback.Record{
		ID: "fb_1", UserID: "user_1", Kind: kind, URL: "https://x.com/a", Host: "x.com", Text: "the words <b>",
		Context:   json.RawMessage(`{"adapter":"x","extVersion":"1.2.3"}`),
		Details:   json.RawMessage(`{"reason":"no-words"}`),
		Status:    feedback.StatusNew,
		CreatedAt: time.Date(2026, 11, 5, 8, 30, 0, 0, time.UTC),
	}
}

func onlyBody(t *testing.T, resend *fakeResend) map[string]any {
	t.Helper()
	if len(resend.bodies) != 1 {
		t.Fatalf("Resend got %d requests, want 1", len(resend.bodies))
	}
	body := resend.bodies[0]
	if to, _ := body["to"].([]any); len(to) != 1 || to[0] != "admin@example.com" {
		t.Errorf("to = %v, want [admin@example.com]", body["to"])
	}
	return body
}

func TestMailEmailsTheAdminAboutTextAndDefinitionFeedback(t *testing.T) {
	for _, kind := range []feedback.Kind{feedback.KindText, feedback.KindDefinition} {
		t.Run(string(kind), func(t *testing.T) {
			resend := newFakeResend(t)

			if err := mailTo(resend).NotifyNewFeedback(record(kind)); err != nil {
				t.Fatalf("NotifyNewFeedback = %v, want nil", err)
			}
			body := onlyBody(t, resend)
			if want := "Catglish feedback: " + string(kind) + " (x.com)"; body["subject"] != want {
				t.Errorf("subject = %v, want %q", body["subject"], want)
			}
			htmlBody, _ := body["html"].(string)
			for _, want := range []string{
				string(kind), "the words &lt;b&gt;", "https://x.com/a", "user_1", "fb_1",
				"2026-11-05T08:30:00Z", "&#34;extVersion&#34;: &#34;1.2.3&#34;", "&#34;reason&#34;: &#34;no-words&#34;",
			} {
				if !strings.Contains(htmlBody, want) {
					t.Errorf("html %q lacks %q", htmlBody, want)
				}
			}
		})
	}
}

func TestMailEmailsThePageReportAsBefore(t *testing.T) {
	resend := newFakeResend(t)

	if err := mailTo(resend).NotifyNewFeedback(record(feedback.KindPageReport)); err != nil {
		t.Fatalf("NotifyNewFeedback = %v, want nil", err)
	}
	if body := onlyBody(t, resend); body["subject"] != "Catglish page report: x.com (no-words)" {
		t.Errorf("subject = %v, want the page report subject", body["subject"])
	}
}

func TestMailSendsNothingForAnArticleChoice(t *testing.T) {
	resend := newFakeResend(t)

	if err := mailTo(resend).NotifyNewFeedback(record(feedback.KindArticleChoice)); err != nil {
		t.Fatalf("NotifyNewFeedback = %v, want nil", err)
	}
	if len(resend.bodies) != 0 {
		t.Errorf("Resend got %d requests, want none", len(resend.bodies))
	}
}
