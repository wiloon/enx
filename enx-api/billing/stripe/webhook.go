package stripe

import (
	stripeSDK "github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"
)

// ConstructEvent verifies a webhook request's Stripe-Signature header
// against webhookSecret and parses the payload into a stripe.Event. Callers
// MUST reject the request (HTTP 400) on error rather than process the
// payload -- an unverified payload could be forged by anyone who finds the
// endpoint URL (ADR-009 Decision 3: the webhook route carries no
// cognitoAuth, signature verification is the only defense).
func ConstructEvent(payload []byte, sigHeader, webhookSecret string) (stripeSDK.Event, error) {
	return webhook.ConstructEvent(payload, sigHeader, webhookSecret)
}
