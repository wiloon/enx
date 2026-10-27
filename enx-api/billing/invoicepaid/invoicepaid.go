// Package invoicepaid decides a durably received invoice.paid event, the only
// event that changes subscription credits (ADR-067 §积分随 Stripe 事件调整).
// It attributes the invoice's subscription to its owner (§用户关联与乱序恢复),
// accepts it or classifies it as a conflict when it is new
// (§订阅归属与接受关系), and works out the credit effect from the recorded
// pool provenance (§积分周期与退款来源).
//
// Handler reads the store and Stripe outside any database transaction and
// writes nothing: the local changes go out as Effects, which the worker's
// task store commits with the task's next state under its claim, after
// revalidating what Effects.Observed says was read.
package invoicepaid

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/alert"
	"enx-api/billing/attribution"
	"enx-api/billing/creditperiod"
	"enx-api/billing/eligibility"
	"enx-api/billing/invoice"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
)

// ErrStale: what Effects.Observed says was read changed before Save, or the
// invoice's grant was recorded meanwhile, or the owner's deletion began, so
// nothing was applied and the worker retries.
var ErrStale = errors.New("billing/invoicepaid: the invoice's billing records changed since they were read")

// Reasons this package adds to the ones of the rules it applies.
const (
	// ReasonNotASubscriptionInvoice: a one-off invoice keeps its
	// non-subscription handling, which grants nothing here.
	ReasonNotASubscriptionInvoice = "not_a_subscription_invoice"
	// ReasonMalformedInvoice: the payload of a supported version is not an
	// invoice ENX can read.
	ReasonMalformedInvoice = "malformed_invoice"
	// ReasonStaleSubscriptionInvoice: the subscription ended before ENX
	// accepted it, yet an invoice of it was paid. Nothing is granted.
	ReasonStaleSubscriptionInvoice = "stale_subscription_invoice"
	// ReasonDeletionInProgress: the owner's account deletion is in progress;
	// decide again once it completes or aborts.
	ReasonDeletionInProgress = "deletion_in_progress"
	// ReasonTierCreditsUnset: the invoice's tier has no per-period credits
	// configured.
	ReasonTierCreditsUnset = "tier_credits_not_configured"
)

// Subscription is ENX's record of a Stripe subscription. Known is false when
// ENX has no row for it yet.
type Subscription struct {
	Known bool
	// OwnerUserID is the already verified owner, "" until attribution.
	OwnerUserID string
	// CheckoutUserID is the client_reference_id of the stored Checkout
	// association that created the subscription, "" when there is none.
	CheckoutUserID string
	Classification acceptance.Classification
	// Version changes on every write to the row.
	Version int64
}

// Owner is the billing state of a subscription's owner.
type Owner struct {
	// AcceptedID is the owner's accepted subscription, "" when none.
	AcceptedID string
	// Revision is the owner's billing revision; every acceptance-relevant
	// write changes it, and so does every change to the pool's provenance
	// or to a stored grant's Source, which credit decisions read.
	Revision int64
	Deletion acceptance.Deletion
	// Owned is every subscription the owner owns, with its conflict
	// resolution and stored status. Handler reads the live state it needs.
	Owned []eligibility.Owned
	// Pool is where today's subscription_balance came from.
	Pool creditperiod.Pool
}

// Store reads ENX's billing records. None of the reads needs a lock: Save
// revalidates Effects.Observed before it applies anything.
type Store interface {
	// Payload is the event's original payload.
	Payload(ctx context.Context, scope webhookevent.Scope) ([]byte, error)
	// InvoiceRecorded reports whether a billing effect of the invoice is
	// already recorded, from this event or another one.
	InvoiceRecorded(ctx context.Context, invoiceID string) (bool, error)
	Subscription(ctx context.Context, subscriptionID string) (Subscription, error)
	Owner(ctx context.Context, userID string) (Owner, error)
	// NormalGrantEndingAt is the stored normal grant of subscriptionID whose
	// period ends at periodEnd, nil when there is none yet.
	NormalGrantEndingAt(ctx context.Context, subscriptionID string, periodEnd int64) (*creditperiod.Grant, error)
}

// Stripe reads live Stripe state.
type Stripe interface {
	SubscriptionStatus(ctx context.Context, subscriptionID string) (string, error)
	// InvoicePaymentIntent is the PaymentIntent that paid the invoice, ""
	// when none did.
	InvoicePaymentIntent(ctx context.Context, invoiceID string) (string, error)
}

// Plans is the configured subscription tiers.
type Plans struct {
	// TierForPrice maps each configured tier Price ID to its tier.
	TierForPrice map[string]string
	// Credits is each tier's per-period credits.
	Credits map[string]int64
}

// Observed is what a decision read. Save applies the Effects only while the
// subscription row, the owner's accepted pointer and billing revision are
// still these; otherwise it changes nothing and the worker retries.
type Observed struct {
	SubscriptionID      string
	SubscriptionKnown   bool
	SubscriptionVersion int64
	OwnerUserID         string
	AcceptedID          string
	Revision            int64
}

// Attribution records the subscription's owner, creating its row if ENX had
// none. It never creates the user: after the owner's account deletion it
// only retains the subscription and Customer as financial context
// (ADR-067 §注销与财务留存).
type Attribution struct {
	UserID     string
	CustomerID string
}

// Classification is the subscription's new ENX classification. Accepted
// also points the owner's acceptance at it.
type Classification struct {
	To acceptance.Classification
	// ConflictReason and ConflictWith (the accepted subscription at
	// detection, "" when none) are set for a conflict, with its discovery
	// time and pending administrator alert.
	ConflictReason string
	ConflictWith   string
	DiscoveredAt   time.Time
	Alert          alert.Alert
}

// GrantKind is the kind of subscription billing effect.
type GrantKind string

const (
	NormalGrant  GrantKind = "normal_period"
	UpgradeTopUp GrantKind = "upgrade_top_up"
)

// Grant is the invoice's billing effect, recorded whatever reached the pool.
// Source is the subscription period the credits belong to: the line's
// period for a normal grant, the normal grant's period an upgrade tops up.
// Applied is what reaches the pool: an applied normal grant resets the pool
// to it and moves the pool's provenance to Source, applied upgrade top-up
// credits add to it, and zero leaves the pool alone.
type Grant struct {
	Kind            GrantKind
	InvoiceID       string
	PaymentIntentID string
	FromTier        string
	Tier            string
	Source          creditperiod.Source
	Purchased       int64
	Applied         int64
}

// Effects are the local changes a decided invoice commits with its task.
type Effects struct {
	Observed       Observed
	Attribution    *Attribution
	Classification *Classification
	Grant          *Grant
	// FirstPayment goes to the referral domain (ADR-051) in the same
	// transaction; it decides whether this payment is the first.
	FirstPayment *referral.FirstPayment
}

// Handler decides invoice.paid events.
type Handler struct {
	store  Store
	stripe Stripe
	plans  Plans
	now    func() time.Time
}

// NewHandler returns a handler.
func NewHandler(store Store, stripe Stripe, plans Plans, now func() time.Time) *Handler {
	return &Handler{store: store, stripe: stripe, plans: plans, now: now}
}

// Handle decides one invoice.paid event. A one-off invoice has no effect,
// and an invoice another Event ID already recorded changes nothing. An
// invoice the classifier cannot read needs attention before any lookup. The
// subscription's owner comes only from trusted evidence; without any the
// event waits for its Checkout. A new subscription is accepted, kept as a
// conflict with a pending alert, or marked stale; conflicts grant nothing,
// and a paid invoice of a stale subscription needs attention. While the
// owner's deletion is in progress nothing is accepted or granted; after it
// the payment needs attention, retaining only a new subscription's
// ownership. Otherwise the invoice records its grant, and
// the pool takes it only as creditperiod allows.
func (h *Handler) Handle(ctx context.Context, s webhookevent.StoredTask) webhookevent.Result {
	payload, err := h.store.Payload(ctx, s.Scope)
	if err != nil {
		return transient(err)
	}
	inv, err := invoice.DecodeEvent(payload)
	switch {
	case errors.Is(err, invoice.ErrUnsupportedAPIVersion):
		return unrecoverable(webhookevent.ReasonUnsupportedAPIVersion, nil)
	case err != nil:
		return unrecoverable(ReasonMalformedInvoice, nil)
	}
	if inv.SubscriptionID == "" {
		return webhookevent.Result{Step: webhookevent.NoEffect, Reason: ReasonNotASubscriptionInvoice}
	}
	// Another Event ID of the same invoice already recorded its effect.
	recorded, err := h.store.InvoiceRecorded(ctx, inv.ID)
	if err != nil {
		return transient(err)
	}
	if recorded {
		return webhookevent.Result{Step: webhookevent.Handled}
	}

	c := invoice.Classify(inv, h.plans.TierForPrice)
	if c.Kind == invoice.NeedsAttention {
		return unrecoverable(c.Reason, nil)
	}

	sub, err := h.store.Subscription(ctx, inv.SubscriptionID)
	if err != nil {
		return transient(err)
	}
	owned := attribution.Attribute(attribution.Evidence{
		MetadataUserID: inv.MetadataUserID,
		CheckoutUserID: sub.CheckoutUserID,
		OwnerUserID:    sub.OwnerUserID,
	})
	switch owned.Outcome {
	case attribution.Missing:
		return webhookevent.Result{Step: webhookevent.MissingDependency, Reason: owned.Reason}
	case attribution.Contradictory:
		return unrecoverable(owned.Reason, nil)
	}
	owner, err := h.store.Owner(ctx, owned.UserID)
	if err != nil {
		return transient(err)
	}

	e := Effects{Observed: Observed{
		SubscriptionID:      inv.SubscriptionID,
		SubscriptionKnown:   sub.Known,
		SubscriptionVersion: sub.Version,
		OwnerUserID:         owned.UserID,
		AcceptedID:          owner.AcceptedID,
		Revision:            owner.Revision,
	}}
	if sub.OwnerUserID == "" {
		e.Attribution = &Attribution{UserID: owned.UserID, CustomerID: inv.CustomerID}
	}

	switch sub.Classification {
	case acceptance.Conflict:
		return webhookevent.Result{Step: webhookevent.Handled, Effects: e}
	case acceptance.Stale:
		return unrecoverable(ReasonStaleSubscriptionInvoice, e)
	case acceptance.Accepted:
	case acceptance.Unclassified:
		d, err := h.decide(ctx, inv.SubscriptionID, owner)
		if err != nil {
			return transient(err)
		}
		switch d.Outcome {
		case acceptance.Accept:
			e.Classification = &Classification{To: acceptance.Accepted}
		case acceptance.Replay:
		case acceptance.MarkConflict:
			now := h.now()
			e.Classification = &Classification{
				To: acceptance.Conflict, ConflictReason: d.Reason, ConflictWith: d.ConflictWith,
				DiscoveredAt: now, Alert: alert.Raise(alert.Alert{}, now),
			}
			return webhookevent.Result{Step: webhookevent.Handled, Effects: e}
		case acceptance.MarkStale:
			e.Classification = &Classification{To: acceptance.Stale}
			return unrecoverable(ReasonStaleSubscriptionInvoice, e)
		case acceptance.WaitForDeletion:
			return webhookevent.Result{Step: webhookevent.MissingDependency, Reason: ReasonDeletionInProgress}
		default:
			if d.Reason == acceptance.ReasonPaymentAfterAccountDeletion && e.Attribution != nil {
				return unrecoverable(d.Reason, e)
			}
			return unrecoverable(d.Reason, nil)
		}
	default:
		return transient(fmt.Errorf("billing/invoicepaid: subscription %s has unknown classification %q", inv.SubscriptionID, sub.Classification))
	}
	switch owner.Deletion {
	case acceptance.DeletionInProgress:
		return webhookevent.Result{Step: webhookevent.MissingDependency, Reason: ReasonDeletionInProgress}
	case acceptance.DeletionCompleted:
		return unrecoverable(acceptance.ReasonPaymentAfterAccountDeletion, nil)
	}

	current := owner.AcceptedID == inv.SubscriptionID || (e.Classification != nil && e.Classification.To == acceptance.Accepted)
	grant, effect, err := h.credit(ctx, c, owner.Pool, current)
	if err != nil {
		return transient(err)
	}
	switch effect.Outcome {
	case creditperiod.WaitDependency:
		return webhookevent.Result{Step: webhookevent.MissingDependency, Reason: effect.Reason, Effects: e}
	case creditperiod.NeedsAttention:
		return unrecoverable(effect.Reason, e)
	}

	var paymentIntentID string
	if inv.AmountPaid > 0 {
		if paymentIntentID, err = h.stripe.InvoicePaymentIntent(ctx, inv.ID); err != nil {
			return transient(err)
		}
	}
	grant.InvoiceID, grant.PaymentIntentID = inv.ID, paymentIntentID
	e.Grant = &grant
	if inv.AmountPaid > 0 {
		e.FirstPayment = &referral.FirstPayment{
			Kind: referral.KindSubscription, PaymentIntentID: paymentIntentID, InvoiceID: inv.ID,
			Credits: effect.Purchased, PaidAt: eventCreated(payload),
		}
	}
	return webhookevent.Result{Step: webhookevent.Handled, Effects: e}
}

// credit works out the invoice's billing effect on the owner's pool;
// accepted reports whether its subscription is the owner's current accepted
// one. The returned Grant lacks the invoice and PaymentIntent IDs. The error
// is a storage failure.
func (h *Handler) credit(ctx context.Context, c invoice.Classification, pool creditperiod.Pool, accepted bool) (Grant, creditperiod.Effect, error) {
	credits, from := h.plans.Credits[c.Tier], int64(0)
	if c.Kind == invoice.UpgradeTopUp {
		from = h.plans.Credits[c.FromTier]
	}
	if credits <= 0 || (c.Kind == invoice.UpgradeTopUp && from <= 0) {
		return Grant{}, creditperiod.Effect{Outcome: creditperiod.NeedsAttention, Reason: ReasonTierCreditsUnset}, nil
	}

	if c.Kind == invoice.PeriodGrant {
		source := creditperiod.Source{SubscriptionID: c.SubscriptionID, Period: c.Period}
		effect := creditperiod.NormalGrant(pool, source, accepted, credits)
		return Grant{Kind: NormalGrant, Tier: c.Tier, Source: source, Purchased: effect.Purchased, Applied: effect.Credits}, effect, nil
	}

	periodGrant, err := h.store.NormalGrantEndingAt(ctx, c.SubscriptionID, c.Period.End)
	if err != nil {
		return Grant{}, creditperiod.Effect{}, err
	}
	effect, err := creditperiod.UpgradeTopUp(creditperiod.Upgrade{
		Pool: pool, Accepted: accepted, SubscriptionID: c.SubscriptionID, Line: c.Period,
		FromCredits: from, ToCredits: credits, PeriodGrant: periodGrant,
	})
	if err != nil {
		return Grant{}, creditperiod.Effect{Outcome: creditperiod.NeedsAttention, Reason: err.Error()}, nil
	}
	g := Grant{Kind: UpgradeTopUp, FromTier: c.FromTier, Tier: c.Tier, Purchased: effect.Purchased, Applied: effect.Credits}
	if periodGrant != nil {
		g.Source = periodGrant.Source
	}
	return g, effect, nil
}

// decide reads the live Stripe state of the incoming subscription, of the
// owner's accepted one and of any resolved conflict whose stored status is
// not terminal, and applies the acceptance rules.
func (h *Handler) decide(ctx context.Context, incomingID string, owner Owner) (acceptance.Decision, error) {
	o := acceptance.Observation{IncomingID: incomingID, AcceptedID: owner.AcceptedID, Deletion: owner.Deletion}
	var err error
	if o.IncomingStatus, err = h.stripe.SubscriptionStatus(ctx, incomingID); err != nil {
		return acceptance.Decision{}, err
	}
	if owner.AcceptedID != "" && owner.AcceptedID != incomingID {
		if o.AcceptedStatus, err = h.stripe.SubscriptionStatus(ctx, owner.AcceptedID); err != nil {
			return acceptance.Decision{}, err
		}
	}
	owned := make([]eligibility.Owned, len(owner.Owned))
	for i, s := range owner.Owned {
		if s.Conflict == eligibility.ConflictResolved && s.Live == nil && eligibility.NeedsLiveLookup(s) {
			status, err := h.stripe.SubscriptionStatus(ctx, s.ID)
			if err != nil {
				return acceptance.Decision{}, err
			}
			s.Live = &eligibility.Live{Status: status}
		}
		owned[i] = s
	}
	blocking, err := eligibility.BlockingConflict(owned)
	if err != nil {
		return acceptance.Decision{}, err
	}
	o.BlockingConflict = blocking != ""
	return acceptance.Decide(o), nil
}

func transient(err error) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Transient, Reason: err.Error()}
}

// unrecoverable needs attention, committing effects (nil for none) with it.
func unrecoverable(reason string, effects any) webhookevent.Result {
	return webhookevent.Result{Step: webhookevent.Unrecoverable, Reason: reason, Effects: effects}
}

// eventCreated is when Stripe created the event, which every API version
// carries in its envelope; zero when the payload has none.
func eventCreated(payload []byte) time.Time {
	var env struct {
		Created int64 `json:"created"`
	}
	if json.Unmarshal(payload, &env) != nil || env.Created <= 0 {
		return time.Time{}
	}
	return time.Unix(env.Created, 0)
}
