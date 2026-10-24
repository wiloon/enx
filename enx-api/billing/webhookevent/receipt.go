package webhookevent

import (
	"encoding/json"
	"errors"
	"fmt"
)

var (
	// ErrBadSignature: the caller's signature check refused the request.
	// Receipt answers 400 and stores nothing.
	ErrBadSignature = errors.New("billing/webhookevent: bad Stripe signature")
	// ErrMalformedEnvelope: a signature-verified payload is not a Stripe
	// event envelope ENX can store. Receipt answers 400 and stores nothing.
	ErrMalformedEnvelope = errors.New("billing/webhookevent: malformed Stripe event envelope")
)

// Outcome is what receipt tells Stripe and records for observability.
// Accepted means the delivery is durably stored (2xx). Otherwise Retryable
// asks Stripe to deliver again (non-2xx other than 400); a refusal that is
// not retryable stores no trusted history (400).
type Outcome struct {
	Reason    string
	Accepted  bool
	Retryable bool
}

// ReceiptOutcome is the outcome of a receipt that ended with err: nil once
// the delivery and its event task are committed. Any error other than the
// refusals here is a failure to store, which Stripe must retry.
func ReceiptOutcome(err error) Outcome {
	switch {
	case err == nil:
		return Outcome{Reason: "received", Accepted: true}
	case errors.Is(err, ErrBadSignature):
		return Outcome{Reason: "bad_signature"}
	case errors.Is(err, ErrMalformedEnvelope):
		return Outcome{Reason: "malformed_envelope"}
	case errors.Is(err, ErrWrongAccount):
		return Outcome{Reason: "wrong_account"}
	case errors.Is(err, ErrWrongMode):
		return Outcome{Reason: "wrong_mode"}
	case errors.Is(err, ErrEndpointUnknown):
		return Outcome{Reason: "endpoint_unknown", Retryable: true}
	}
	return Outcome{Reason: "storage_failed", Retryable: true}
}

// Envelope is what receipt reads from a signature-verified payload before
// any business object is decoded. It is the same in every API version.
type Envelope struct {
	EventID    string
	Type       string
	Created    int64
	APIVersion string
	// Account is the event's own account field, empty for an ordinary
	// direct-account event.
	Account  string
	Livemode bool
}

// References are the Stripe objects an event names, kept on the event task
// so a later association can find and wake it. Any of them may be empty;
// none of them says which ENX user the event belongs to.
type References struct {
	SubscriptionID    string
	CustomerID        string
	CheckoutSessionID string
	InvoiceID         string
	PaymentIntentID   string
	ChargeID          string
}

// Receipt is a received event admitted to this endpoint: its envelope, its
// scoped Event ID and the references read with its API version's adapter.
// The caller appends the delivery with the raw payload and ensures the
// event task exists in one transaction.
type Receipt struct {
	Envelope Envelope
	Scope    Scope
	Refs     References
}

// dahliaVersions are the API versions whose business objects receipt reads.
// 2026-08-26 is stripe-go v86.4.2's pinned version; 2026-07-29 is what the
// Sandbox endpoint delivered for the fixtures. An event of any other
// version is still received, with no references; the worker escalates it.
var dahliaVersions = map[string]bool{
	"2026-07-29.dahlia": true,
	"2026-08-26.dahlia": true,
}

// Receive reads the envelope of a signature-verified payload and admits it
// to the endpoint.
func Receive(e Endpoint, payload []byte) (Receipt, error) {
	env, object, err := parseEnvelope(payload)
	if err != nil {
		return Receipt{}, err
	}
	if err := e.Admit(env.Account, env.Livemode); err != nil {
		return Receipt{}, err
	}
	r := Receipt{Envelope: env, Scope: e.Scope(env.EventID)}
	if dahliaVersions[env.APIVersion] {
		r.Refs = dahliaReferences(object)
	}
	return r, nil
}

// dahliaReferences reads the references of a dahlia business object. An
// expandable field is either an ID or an expanded object with an id.
func dahliaReferences(object json.RawMessage) References {
	var o struct {
		Object       string          `json:"object"`
		ID           string          `json:"id"`
		Customer     json.RawMessage `json:"customer"`
		Subscription json.RawMessage `json:"subscription"`
		// A released schedule has no subscription; it names the one it
		// released here instead.
		ReleasedSubscription json.RawMessage `json:"released_subscription"`
		PaymentIntent        json.RawMessage `json:"payment_intent"`
		Parent               *struct {
			SubscriptionDetails *struct {
				Subscription json.RawMessage `json:"subscription"`
			} `json:"subscription_details"`
		} `json:"parent"`
	}
	if json.Unmarshal(object, &o) != nil {
		return References{}
	}
	refs := References{CustomerID: expandableID(o.Customer)}
	switch o.Object {
	case "subscription":
		refs.SubscriptionID = o.ID
	case "subscription_schedule":
		refs.SubscriptionID = expandableID(o.Subscription)
		if refs.SubscriptionID == "" {
			refs.SubscriptionID = expandableID(o.ReleasedSubscription)
		}
	case "invoice":
		refs.InvoiceID = o.ID
		if o.Parent != nil && o.Parent.SubscriptionDetails != nil {
			refs.SubscriptionID = expandableID(o.Parent.SubscriptionDetails.Subscription)
		}
	case "checkout.session":
		refs.CheckoutSessionID = o.ID
		refs.SubscriptionID = expandableID(o.Subscription)
		refs.PaymentIntentID = expandableID(o.PaymentIntent)
	case "charge":
		refs.ChargeID = o.ID
		refs.PaymentIntentID = expandableID(o.PaymentIntent)
	}
	return refs
}

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

type rawEnvelope struct {
	ID         string  `json:"id"`
	Object     string  `json:"object"`
	Type       string  `json:"type"`
	Created    int64   `json:"created"`
	APIVersion *string `json:"api_version"`
	Account    *string `json:"account"`
	Livemode   *bool   `json:"livemode"`
	Data       struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

func parseEnvelope(payload []byte) (Envelope, json.RawMessage, error) {
	var raw rawEnvelope
	if err := json.Unmarshal(payload, &raw); err != nil {
		return Envelope{}, nil, fmt.Errorf("%w: %v", ErrMalformedEnvelope, err)
	}
	switch {
	case raw.Object != "event":
		return Envelope{}, nil, fmt.Errorf("%w: object %q", ErrMalformedEnvelope, raw.Object)
	case raw.ID == "", raw.Type == "", raw.Created <= 0, raw.Livemode == nil:
		return Envelope{}, nil, fmt.Errorf("%w: missing id, type, created or livemode", ErrMalformedEnvelope)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw.Data.Object, &object); err != nil || object == nil {
		return Envelope{}, nil, fmt.Errorf("%w: data.object is not an object", ErrMalformedEnvelope)
	}
	env := Envelope{EventID: raw.ID, Type: raw.Type, Created: raw.Created}
	if raw.APIVersion != nil {
		env.APIVersion = *raw.APIVersion
	}
	if raw.Account != nil {
		env.Account = *raw.Account
	}
	if raw.Livemode != nil {
		env.Livemode = *raw.Livemode
	}
	return env, raw.Data.Object, nil
}
