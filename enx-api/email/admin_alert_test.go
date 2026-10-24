package email

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"enx-api/config"
)

var alertResend = config.Resend{APIKey: "re_test", From: "Catglish <no-reply@catglish.com>", AdminTo: "admin@example.com"}

type fakeResend struct {
	*httptest.Server
	requests []*http.Request
	bodies   []map[string]any
}

func newFakeResend(t *testing.T, handler func(w http.ResponseWriter, r *http.Request)) *fakeResend {
	t.Helper()
	f := &fakeResend{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		f.requests = append(f.requests, r)
		f.bodies = append(f.bodies, body)
		handler(w, r)
	}))
	t.Cleanup(f.Close)
	return f
}

func alertSender(cfg config.Resend, endpoint string) *Sender {
	s := NewSender(cfg)
	s.endpoint = endpoint
	return s
}

func TestSendAdminAlertDeliversThePlainTextMailToTheAdmin(t *testing.T) {
	resend := newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"email_1"}`))
	})

	err := alertSender(alertResend, resend.URL).SendAdminAlert(context.Background(), "Catglish billing: x", "line 1\nline 2\n")
	if err != nil {
		t.Fatalf("SendAdminAlert = %v, want nil", err)
	}
	if len(resend.requests) != 1 {
		t.Fatalf("Resend got %d requests, want 1", len(resend.requests))
	}
	if got := resend.requests[0].Header.Get("Authorization"); got != "Bearer re_test" {
		t.Errorf("Authorization = %q, want the API key as bearer", got)
	}
	body := resend.bodies[0]
	if body["from"] != alertResend.From || body["subject"] != "Catglish billing: x" || body["text"] != "line 1\nline 2\n" {
		t.Errorf("request body = %v", body)
	}
	if to, _ := body["to"].([]any); len(to) != 1 || to[0] != "admin@example.com" {
		t.Errorf("to = %v, want only the admin recipient", body["to"])
	}
}

func TestSendAdminAlertReportsMissingConfigurationWithoutSending(t *testing.T) {
	cases := map[string]func(*config.Resend){
		"no API key":         func(c *config.Resend) { c.APIKey = "" },
		"no sender":          func(c *config.Resend) { c.From = "" },
		"no admin recipient": func(c *config.Resend) { c.AdminTo = "" },
	}
	for name, unset := range cases {
		t.Run(name, func(t *testing.T) {
			resend := newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
			cfg := alertResend
			unset(&cfg)

			err := alertSender(cfg, resend.URL).SendAdminAlert(context.Background(), "s", "t")
			if !errors.Is(err, ErrAlertMailNotConfigured) {
				t.Errorf("SendAdminAlert = %v, want ErrAlertMailNotConfigured", err)
			}
			if len(resend.requests) != 0 {
				t.Errorf("Resend got %d requests, want none", len(resend.requests))
			}
		})
	}
}

func TestSendAdminAlertReportsAProviderFailure(t *testing.T) {
	resend := newFakeResend(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	if err := alertSender(alertResend, resend.URL).SendAdminAlert(context.Background(), "s", "t"); err == nil {
		t.Error("SendAdminAlert = nil after a Resend 500, want an error")
	}
}

func TestSendAdminAlertGivesUpAtTheContextDeadline(t *testing.T) {
	release := make(chan struct{})
	resend := newFakeResend(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
		w.WriteHeader(http.StatusOK)
	})
	defer close(release)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- alertSender(alertResend, resend.URL).SendAdminAlert(ctx, "s", "t") }()

	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("SendAdminAlert = %v, want context.DeadlineExceeded", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SendAdminAlert did not return at the context deadline")
	}
}
