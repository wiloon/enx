package chargerefunded

import (
	"encoding/json"
	"errors"
	"fmt"
)

var (
	// ErrUnsupportedAPIVersion: the event's api_version has no adapter here;
	// the event needs attention rather than a guess at its schema.
	ErrUnsupportedAPIVersion = errors.New("billing/chargerefunded: unsupported Stripe API version")
	// ErrNotARefundedCharge: the event does not carry a charge with a valid
	// cumulative refund.
	ErrNotARefundedCharge = errors.New("billing/chargerefunded: not a refunded charge")
)

// dahliaVersions are the API versions this adapter reads. 2026-08-26 is
// stripe-go v86.4.2's pinned version; 2026-07-29 is what the Sandbox
// endpoint delivered for the fixtures.
var dahliaVersions = map[string]bool{
	"2026-07-29.dahlia": true,
	"2026-08-26.dahlia": true,
}

// Charge is a refunded charge, normalized across supported API versions.
// Refunded and Captured are Stripe's cumulative amount_refunded and
// amount_captured, in the smallest currency unit.
type Charge struct {
	ID string
	// PaymentIntentID is "" for a charge no PaymentIntent created.
	PaymentIntentID string
	Refunded        int64
	Captured        int64
}

// DecodeEvent reads a charge.refunded event's raw payload with the adapter
// for its api_version, never the current SDK's schema.
func DecodeEvent(payload []byte) (Charge, error) {
	var e struct {
		APIVersion string `json:"api_version"`
		Data       struct {
			Object struct {
				ID             string          `json:"id"`
				Object         string          `json:"object"`
				PaymentIntent  json.RawMessage `json:"payment_intent"`
				AmountRefunded int64           `json:"amount_refunded"`
				AmountCaptured int64           `json:"amount_captured"`
			} `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &e); err != nil {
		return Charge{}, fmt.Errorf("billing/chargerefunded: decode event: %w", err)
	}
	if !dahliaVersions[e.APIVersion] {
		return Charge{}, fmt.Errorf("%w: %q", ErrUnsupportedAPIVersion, e.APIVersion)
	}
	o := e.Data.Object
	if o.Object != "charge" || o.ID == "" {
		return Charge{}, fmt.Errorf("%w: object %q", ErrNotARefundedCharge, o.Object)
	}
	if o.AmountCaptured <= 0 || o.AmountRefunded < 0 || o.AmountRefunded > o.AmountCaptured {
		return Charge{}, fmt.Errorf("%w: refunded %d of captured %d", ErrNotARefundedCharge, o.AmountRefunded, o.AmountCaptured)
	}
	return Charge{
		ID:              o.ID,
		PaymentIntentID: expandableID(o.PaymentIntent),
		Refunded:        o.AmountRefunded,
		Captured:        o.AmountCaptured,
	}, nil
}

// expandableID reads an expandable field: an ID, an expanded object with an
// id, or null.
func expandableID(field json.RawMessage) string {
	var id string
	if json.Unmarshal(field, &id) == nil {
		return id
	}
	var expanded struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(field, &expanded) == nil {
		return expanded.ID
	}
	return ""
}
