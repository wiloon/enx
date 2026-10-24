package webhookevent

// Kind is how the worker handles a received event (ADR-067).
type Kind string

const (
	// KindCheckout: a completed Checkout records attribution and Customer
	// ownership, and grants a top-up; never subscription credits.
	KindCheckout Kind = "checkout"
	// KindInvoicePaid: the only event that changes subscription credits.
	KindInvoicePaid Kind = "invoice_paid"
	// KindRefund: ADR-049's refund and clawback rules.
	KindRefund Kind = "refund"
	// KindSnapshot: refreshes the subscription snapshot only; never grants
	// or deducts credits.
	KindSnapshot Kind = "snapshot"
	// KindIgnore: no supported business effect; the task is ignored with
	// the reason.
	KindIgnore Kind = "ignore"
	// KindEscalate: a supported business event the worker cannot read; the
	// task needs attention with the reason.
	KindEscalate Kind = "escalate"
)

const (
	ReasonUnsupportedEventType  = "unsupported_event_type"
	ReasonUnsupportedAPIVersion = "unsupported_api_version"
)

// Routing is a received event's handling, with the reason for ignoring or
// escalating it.
type Routing struct {
	Kind   Kind
	Reason string
}

var kinds = map[string]Kind{
	"checkout.session.completed":                   KindCheckout,
	"invoice.paid":                                 KindInvoicePaid,
	"charge.refunded":                              KindRefund,
	"invoice.payment_failed":                       KindSnapshot,
	"invoice.voided":                               KindSnapshot,
	"customer.subscription.updated":                KindSnapshot,
	"customer.subscription.deleted":                KindSnapshot,
	"customer.subscription.pending_update_applied": KindSnapshot,
	"customer.subscription.pending_update_expired": KindSnapshot,
	"subscription_schedule.created":                KindSnapshot,
	"subscription_schedule.updated":                KindSnapshot,
	"subscription_schedule.expiring":               KindSnapshot,
	"subscription_schedule.released":               KindSnapshot,
	"subscription_schedule.canceled":               KindSnapshot,
	"subscription_schedule.completed":              KindSnapshot,
	"subscription_schedule.aborted":                KindSnapshot,
}

// Route decides how the worker handles an event of eventType delivered
// with apiVersion. A supported business event whose version has no adapter
// is escalated, never ignored; any other type is ignored whatever its
// version.
func Route(eventType, apiVersion string) Routing {
	kind, ok := kinds[eventType]
	if !ok {
		return Routing{Kind: KindIgnore, Reason: ReasonUnsupportedEventType}
	}
	if !dahliaVersions[apiVersion] {
		return Routing{Kind: KindEscalate, Reason: ReasonUnsupportedAPIVersion}
	}
	return Routing{Kind: kind}
}
