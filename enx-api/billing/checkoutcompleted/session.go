package checkoutcompleted

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var (
	// ErrUnsupportedAPIVersion: the event's api_version has no adapter here;
	// the event needs attention rather than a guess at its schema.
	ErrUnsupportedAPIVersion = errors.New("billing/checkoutcompleted: unsupported Stripe API version")
	// ErrNotACheckoutSession: the event does not carry a Checkout Session.
	ErrNotACheckoutSession = errors.New("billing/checkoutcompleted: not a Checkout Session event")
)

// dahliaVersions are the API versions this adapter reads. 2026-08-26 is
// stripe-go v86.4.2's pinned version; 2026-07-29 is what the Sandbox
// endpoint delivered for the fixtures.
var dahliaVersions = map[string]bool{
	"2026-07-29.dahlia": true,
	"2026-08-26.dahlia": true,
}

// Session is a completed Checkout Session, normalized across supported API
// versions. The IDs are "" where the session has none.
type Session struct {
	ID string
	// Mode is "payment" or "subscription".
	Mode              string
	PaymentStatus     string
	ClientReferenceID string
	CustomerID        string
	SubscriptionID    string
	PaymentIntentID   string
	// Metadata is the session's own metadata, which ENX's Checkout sets:
	// type=topup with its tier, or type=subscription with its plan.
	Metadata map[string]string
	// EventCreated is when Stripe created the event; zero when the payload
	// has none.
	EventCreated time.Time
}

// TopUp reports whether the session is an ENX credit top-up.
func (s Session) TopUp() bool {
	return s.Metadata["type"] == "topup"
}

// DecodeEvent reads a checkout.session.completed event's raw payload with
// the adapter for its api_version, never the current SDK's schema.
func DecodeEvent(payload []byte) (Session, error) {
	var e struct {
		APIVersion string `json:"api_version"`
		Created    int64  `json:"created"`
		Data       struct {
			Object struct {
				ID                string            `json:"id"`
				Object            string            `json:"object"`
				Mode              string            `json:"mode"`
				PaymentStatus     string            `json:"payment_status"`
				ClientReferenceID string            `json:"client_reference_id"`
				Customer          json.RawMessage   `json:"customer"`
				Subscription      json.RawMessage   `json:"subscription"`
				PaymentIntent     json.RawMessage   `json:"payment_intent"`
				Metadata          map[string]string `json:"metadata"`
			} `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &e); err != nil {
		return Session{}, fmt.Errorf("billing/checkoutcompleted: decode event: %w", err)
	}
	if !dahliaVersions[e.APIVersion] {
		return Session{}, fmt.Errorf("%w: %q", ErrUnsupportedAPIVersion, e.APIVersion)
	}
	o := e.Data.Object
	if o.Object != "checkout.session" || o.ID == "" {
		return Session{}, fmt.Errorf("%w: object %q", ErrNotACheckoutSession, o.Object)
	}
	s := Session{
		ID:                o.ID,
		Mode:              o.Mode,
		PaymentStatus:     o.PaymentStatus,
		ClientReferenceID: o.ClientReferenceID,
		CustomerID:        expandableID(o.Customer),
		SubscriptionID:    expandableID(o.Subscription),
		PaymentIntentID:   expandableID(o.PaymentIntent),
		Metadata:          o.Metadata,
	}
	if e.Created > 0 {
		s.EventCreated = time.Unix(e.Created, 0)
	}
	return s, nil
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
