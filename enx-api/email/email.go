package email

import (
	"bytes"
	"context"
	"encoding/json"
	"enx-api/utils/logger"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"

	"github.com/go-resty/resty/v2"

	"enx-api/config"
)

// Sender sends mail through Resend, configured by resend.*.
type Sender struct {
	cfg      config.Resend
	endpoint string
}

func NewSender(cfg config.Resend) *Sender {
	return NewSenderAt(cfg, resendEndpoint)
}

// NewSenderAt is NewSender posting to another Resend endpoint, for tests
// that point a Sender at a fake Resend server.
func NewSenderAt(cfg config.Resend, endpoint string) *Sender {
	return &Sender{cfg: cfg, endpoint: endpoint}
}

const resendEndpoint = "https://api.resend.com/emails"

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html,omitempty"`
	Text    string   `json:"text,omitempty"`
}

// ErrAlertMailNotConfigured: resend.api-key, resend.from or resend.admin-to
// is unset, so a durable admin alert cannot be sent and stays pending.
var ErrAlertMailNotConfigured = errors.New("email: admin alert mail is not configured")

// SendAdminAlert sends a durable billing alert (ADR-067) to resend.admin-to
// as plain text. Unlike the best-effort notifications, missing
// configuration, a provider error and the ctx deadline are all errors: only
// a nil return means Resend confirmed the send.
func (s *Sender) SendAdminAlert(ctx context.Context, subject, text string) error {
	apiKey := s.cfg.APIKey.Reveal()
	var missing []string
	if apiKey == "" {
		missing = append(missing, "resend.api-key")
	}
	if s.cfg.From == "" {
		missing = append(missing, "resend.from")
	}
	if s.cfg.AdminTo == "" {
		missing = append(missing, "resend.admin-to")
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: %s unset", ErrAlertMailNotConfigured, strings.Join(missing, ", "))
	}

	resp, err := resty.New().R().
		SetContext(ctx).
		SetHeader("Authorization", "Bearer "+apiKey).
		SetHeader("Content-Type", "application/json").
		SetBody(resendRequest{
			From:    s.cfg.From,
			To:      []string{s.cfg.AdminTo},
			Subject: subject,
			Text:    text,
		}).
		Post(s.endpoint)
	if err != nil {
		return fmt.Errorf("resend HTTP request failed: %w", err)
	}
	if resp.StatusCode() != http.StatusOK && resp.StatusCode() != http.StatusCreated && resp.StatusCode() != http.StatusAccepted {
		return fmt.Errorf("resend returned status %d", resp.StatusCode())
	}
	return nil
}

func (s *Sender) send(to, subject, htmlBody string) error {
	apiKey := s.cfg.APIKey.Reveal()
	if apiKey == "" {
		logger.Warnf("resend.api-key is not set, skipping email to %s", to)
		return nil
	}

	from := s.cfg.From

	client := resty.New()
	resp, err := client.R().
		SetHeader("Authorization", "Bearer "+apiKey).
		SetHeader("Content-Type", "application/json").
		SetBody(resendRequest{
			From:    from,
			To:      []string{to},
			Subject: subject,
			HTML:    htmlBody,
		}).
		Post(s.endpoint)

	if err != nil {
		return fmt.Errorf("resend HTTP request failed: %w", err)
	}
	if resp.StatusCode() != http.StatusOK && resp.StatusCode() != http.StatusCreated && resp.StatusCode() != http.StatusAccepted {
		return fmt.Errorf("resend returned status %d: %s", resp.StatusCode(), resp.String())
	}
	logger.Infof("email sent to %s via Resend, status %d", to, resp.StatusCode())
	return nil
}

// PageReportNotify is the fields shown in the admin page-report email
// (ADR-010 Decision 12). Kept as a plain struct so the feedback domain does
// not import this package's HTTP helpers.
type PageReportNotify struct {
	URL        string
	Host       string
	Reason     string
	Adapter    string
	ExtVersion string
	CreatedAt  time.Time
}

// NotifyAdminPageReport emails the configured admin when a user records a
// new page report. Best-effort: missing API key or admin-to skips with nil.
func (s *Sender) NotifyAdminPageReport(r PageReportNotify) error {
	to := s.cfg.AdminTo
	if to == "" {
		logger.Warnf("resend.admin-to is not set, skipping page-report notify")
		return nil
	}

	when := r.CreatedAt.UTC().Format(time.RFC3339)
	subject := fmt.Sprintf("Catglish page report: %s (%s)", r.Host, r.Reason)
	htmlBody := fmt.Sprintf(
		"<p>A user sent a page report.</p>"+
			"<ul>"+
			"<li><strong>Host:</strong> %s</li>"+
			"<li><strong>URL:</strong> %s</li>"+
			"<li><strong>Reason:</strong> %s</li>"+
			"<li><strong>Adapter:</strong> %s</li>"+
			"<li><strong>Extension:</strong> %s</li>"+
			"<li><strong>Time (UTC):</strong> %s</li>"+
			"</ul>",
		html.EscapeString(r.Host),
		html.EscapeString(r.URL),
		html.EscapeString(r.Reason),
		html.EscapeString(r.Adapter),
		html.EscapeString(r.ExtVersion),
		html.EscapeString(when),
	)
	return s.send(to, subject, htmlBody)
}

// FeedbackNotify is the fields shown in the admin email for a new text or
// definition feedback record (ADR-076 decision 7). Context and Details are
// the record's raw JSON objects.
type FeedbackNotify struct {
	Kind      string
	Text      string
	URL       string
	Host      string
	UserID    string
	RecordID  string
	Context   []byte
	Details   []byte
	CreatedAt time.Time
}

// NotifyAdminFeedback emails the configured admin when a user records new
// feedback. Best-effort: missing API key or admin-to skips with nil.
func (s *Sender) NotifyAdminFeedback(f FeedbackNotify) error {
	to := s.cfg.AdminTo
	if to == "" {
		logger.Warnf("resend.admin-to is not set, skipping feedback notify")
		return nil
	}

	subject := "Catglish feedback: " + f.Kind
	if f.Host != "" {
		subject += " (" + f.Host + ")"
	}
	htmlBody := fmt.Sprintf(
		"<p>A user sent feedback.</p>"+
			"<ul>"+
			"<li><strong>Kind:</strong> %s</li>"+
			"<li><strong>Text:</strong><div style=\"white-space: pre-wrap\">%s</div></li>"+
			"<li><strong>URL:</strong> %s</li>"+
			"<li><strong>Host:</strong> %s</li>"+
			"<li><strong>User ID:</strong> %s</li>"+
			"<li><strong>Record ID:</strong> %s</li>"+
			"<li><strong>Time (UTC):</strong> %s</li>"+
			"<li><strong>Context:</strong><pre>%s</pre></li>"+
			"<li><strong>Details:</strong><pre>%s</pre></li>"+
			"</ul>",
		html.EscapeString(f.Kind),
		html.EscapeString(f.Text),
		html.EscapeString(f.URL),
		html.EscapeString(f.Host),
		html.EscapeString(f.UserID),
		html.EscapeString(f.RecordID),
		html.EscapeString(f.CreatedAt.UTC().Format(time.RFC3339)),
		html.EscapeString(indentedJSON(f.Context)),
		html.EscapeString(indentedJSON(f.Details)),
	)
	return s.send(to, subject, htmlBody)
}

// indentedJSON shows an empty or invalid JSON value as {}.
func indentedJSON(raw []byte) string {
	if !json.Valid(raw) {
		return "{}"
	}
	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		return "{}"
	}
	return out.String()
}
