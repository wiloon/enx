package email

import (
	"enx-api/utils/logger"
	"fmt"
	"net/http"

	"github.com/go-resty/resty/v2"
	"github.com/spf13/viper"
)

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
}

func sendEmail(to, subject, htmlBody string) error {
	apiKey := viper.GetString("resend.api-key")
	if apiKey == "" {
		logger.Warnf("resend.api-key is not set, skipping email to %s", to)
		return nil
	}

	from := viper.GetString("resend.from")

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

// SendVerificationEmail sends an HTML activation email via the Resend API.
// The activation link is built as: {frontend-base-url}/verify-email?token={token}
func SendVerificationEmail(to, username, token string) error {
	baseURL := viper.GetString("app.frontend-base-url")
	link := fmt.Sprintf("%s/verify-email?token=%s", baseURL, token)
	subject := "Activate your ENX account"
	htmlBody := fmt.Sprintf(
		"<p>Hi %s,</p><p>Click the link below to activate your ENX account. The link expires in 48 hours.</p><p><a href=%q>Activate my account</a></p><p>If you did not create an account, you can safely ignore this email.</p>",
		username, link,
	)
	return sendEmail(to, subject, htmlBody)
}

// SendPasswordResetEmail sends an HTML password reset email via the Resend API.
// The reset link is built as: {frontend-base-url}/reset-password?token={token}
func SendPasswordResetEmail(to, username, token string) error {
	baseURL := viper.GetString("app.frontend-base-url")
	link := fmt.Sprintf("%s/reset-password?token=%s", baseURL, token)
	subject := "Reset your ENX password"
	htmlBody := fmt.Sprintf(
		"<p>Hi %s,</p><p>Click the link below to reset your ENX password. The link expires in 1 hour.</p><p><a href=%q>Reset my password</a></p><p>If you did not request a password reset, you can safely ignore this email.</p>",
		username, link,
	)
	return sendEmail(to, subject, htmlBody)
}
