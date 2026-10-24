package stripe

import (
	"context"
	"errors"
	"fmt"

	"enx-api/billing/webhookevent"

	stripeSDK "github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"
)

// EndpointAccountID is the Stripe account of the configured API key, read
// with GET /v1/account at billing startup. ENX's webhook endpoint belongs to
// this account, and every received event is scoped to it (ADR-067).
func EndpointAccountID(ctx context.Context, sc *stripeSDK.Client) (string, error) {
	account, err := sc.V1Accounts.Retrieve(ctx, &stripeSDK.AccountRetrieveParams{})
	if err != nil {
		return "", fmt.Errorf("billing/stripe: retrieve account: %w", err)
	}
	if account.ID == "" {
		return "", errors.New("billing/stripe: retrieved account has no ID")
	}
	return account.ID, nil
}

// VerifyWebhook checks a webhook request's Stripe-Signature header against
// webhookSecret, with Stripe's default timestamp tolerance, for durable
// receipt (ADR-067). An API version other than the SDK's is not a bad
// signature: the delivery is stored and the worker decides which versions
// it supports. A refused signature is webhookevent.ErrBadSignature; a
// signed payload that is not an event envelope is
// webhookevent.ErrMalformedEnvelope.
func VerifyWebhook(payload []byte, sigHeader, webhookSecret string) error {
	_, err := webhook.ConstructEventWithOptions(payload, sigHeader, webhookSecret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	switch {
	case err == nil:
		return nil
	case errors.Is(err, webhook.ErrInvalidHeader), errors.Is(err, webhook.ErrNoValidSignature),
		errors.Is(err, webhook.ErrNotSigned), errors.Is(err, webhook.ErrTooOld), errors.Is(err, webhook.ErrEmptySecret):
		return fmt.Errorf("%w: %v", webhookevent.ErrBadSignature, err)
	}
	return fmt.Errorf("%w: %v", webhookevent.ErrMalformedEnvelope, err)
}
