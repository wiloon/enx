package alert

import (
	"fmt"
	"strings"
	"time"
)

// Admin API routes an alert mail points to, so an administrator can
// investigate with no new UI (ADR-067 §管理员处理与邮件). The admin handlers
// register the same paths.
const (
	AdminSubscriptionConflictsPath = "/api/admin/subscription-conflicts"
	AdminWebhookEventsPath         = "/api/admin/webhook-events"
)

// NoActionTaken is the line every alert mail carries: ENX never cancels,
// refunds or promotes on its own; the administrator decides in Stripe.
const NoActionTaken = "ENX has cancelled, refunded and granted nothing for this. Check it in Stripe and decide any action by hand."

// Mail is an alert's plain-text administrator mail. It names Stripe and
// local IDs only: no email address, payload or support message, which the
// administrator reads through the admin API.
type Mail struct {
	Subject string
	Text    string
}

// EventAttention is a Stripe webhook event in needs_attention, with the
// references receipt parsed from it; empty ones are left out.
type EventAttention struct {
	AccountID       string
	Livemode        bool
	EventID         string
	EventType       string
	Reason          string
	SubscriptionID  string
	CustomerID      string
	InvoiceID       string
	PaymentIntentID string
	ChargeID        string
}

// Mail is the alert for the event.
func (e EventAttention) Mail() Mail {
	var b mailText
	b.para("A Stripe webhook event needs an administrator.")
	b.para(NoActionTaken)
	b.line("Event", e.EventID)
	b.line("Type", e.EventType)
	b.line("Reason", e.Reason)
	b.line("Stripe account", account(e.AccountID, e.Livemode))
	b.line("Subscription", e.SubscriptionID)
	b.line("Customer", e.CustomerID)
	b.line("Invoice", e.InvoiceID)
	b.line("Payment intent", e.PaymentIntentID)
	b.line("Charge", e.ChargeID)
	b.line("Inspect", "GET "+AdminWebhookEventsPath+"/"+e.EventID)
	return Mail{
		Subject: fmt.Sprintf("Catglish billing: Stripe event %s needs attention (%s)", e.EventID, e.Reason),
		Text:    b.String(),
	}
}

// ConflictFound is a subscription ENX classified as a conflict with the
// user's accepted one.
type ConflictFound struct {
	AccountID              string
	Livemode               bool
	SubscriptionID         string
	AcceptedSubscriptionID string
	OwnerID                string
	CustomerID             string
	Reason                 string
	DiscoveredAt           time.Time
}

// Mail is the discovery alert for the conflict.
func (c ConflictFound) Mail() Mail {
	var b mailText
	b.para("A user has a second live subscription. ENX kept the accepted one and marked the other as a conflict: it grants no credits or referral rewards.")
	b.para(NoActionTaken)
	b.line("Conflicting subscription", c.SubscriptionID)
	b.line("Accepted subscription", c.AcceptedSubscriptionID)
	b.line("User", c.OwnerID)
	b.line("Customer", c.CustomerID)
	b.line("Reason", c.Reason)
	b.line("Stripe account", account(c.AccountID, c.Livemode))
	b.line("Discovered (UTC)", utc(c.DiscoveredAt))
	b.line("Inspect", "GET "+conflictPath(c.SubscriptionID))
	b.line("Resolve", "PATCH "+conflictPath(c.SubscriptionID)+` with {"status":"resolved","notes":"..."}`)
	return Mail{
		Subject: "Catglish billing: subscription conflict " + c.SubscriptionID,
		Text:    b.String(),
	}
}

// SupportRequested is a user's first billing-support request on their
// conflict. The message itself stays on the subscription row.
type SupportRequested struct {
	SubscriptionID string
	OwnerID        string
	RequestedAt    time.Time
}

// Mail is the support alert for the request.
func (s SupportRequested) Mail() Mail {
	var b mailText
	b.para("A user sent a billing-support message about their subscription conflict. Read it with the admin API.")
	b.para(NoActionTaken)
	b.line("Conflicting subscription", s.SubscriptionID)
	b.line("User", s.OwnerID)
	b.line("Sent (UTC)", utc(s.RequestedAt))
	b.line("Inspect", "GET "+conflictPath(s.SubscriptionID))
	return Mail{
		Subject: "Catglish billing: support request on subscription conflict " + s.SubscriptionID,
		Text:    b.String(),
	}
}

type mailText struct{ strings.Builder }

func (b *mailText) para(text string) {
	b.WriteString(text + "\n\n")
}

// line writes "label: value", or nothing when value is unknown.
func (b *mailText) line(label, value string) {
	if value != "" {
		b.WriteString(label + ": " + value + "\n")
	}
}

func account(id string, livemode bool) string {
	if id == "" {
		return ""
	}
	if livemode {
		return id + " (live mode)"
	}
	return id + " (test mode)"
}

func utc(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func conflictPath(subscriptionID string) string {
	return AdminSubscriptionConflictsPath + "/" + subscriptionID
}
