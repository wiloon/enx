package email

import (
	"enx-api/utils/logger"
	"fmt"
	"html"
	"net/http"
	"time"

	"github.com/go-resty/resty/v2"

	"enx-api/config"
)

// Sender sends mail through Resend, configured by resend.*.
type Sender struct {
	cfg config.Resend
}

func NewSender(cfg config.Resend) *Sender {
	return &Sender{cfg: cfg}
}

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
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
		Post("https://api.resend.com/emails")

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
// (ADR-010 Decision 12). Kept as a plain struct so pagereport does not
// import this package's HTTP helpers.
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

// UnmatchedRefundNotify is the fields shown in the admin email for a Stripe
// refund that matched no credit grant (ADR-049 Decision 7).
type UnmatchedRefundNotify struct {
	EventID         string
	ChargeID        string
	PaymentIntentID string
	AmountRefunded  int64 // cumulative, smallest currency unit
	Currency        string
}

// NotifyAdminUnmatchedRefund emails the configured admin that a refund took
// no credits back because ENX has no grant for its payment intent.
// Best-effort like NotifyAdminPageReport: no admin-to skips with nil.
func (s *Sender) NotifyAdminUnmatchedRefund(r UnmatchedRefundNotify) error {
	to := s.cfg.AdminTo
	if to == "" {
		logger.Warnf("resend.admin-to is not set, skipping unmatched-refund notify")
		return nil
	}

	subject := fmt.Sprintf("Catglish refund matched no credits: %s", r.PaymentIntentID)
	htmlBody := fmt.Sprintf(
		"<p>A Stripe refund arrived, but no credit grant recorded its payment, so no credits were taken back. "+
			"Check the user in Stripe and adjust their credits by hand if needed.</p>"+
			"<ul>"+
			"<li><strong>Payment intent:</strong> %s</li>"+
			"<li><strong>Charge:</strong> %s</li>"+
			"<li><strong>Refunded so far:</strong> %d %s (smallest unit)</li>"+
			"<li><strong>Event:</strong> %s</li>"+
			"</ul>",
		html.EscapeString(r.PaymentIntentID),
		html.EscapeString(r.ChargeID),
		r.AmountRefunded,
		html.EscapeString(r.Currency),
		html.EscapeString(r.EventID),
	)
	return s.send(to, subject, htmlBody)
}
