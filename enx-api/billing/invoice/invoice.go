// Package invoice classifies a paid Stripe subscription invoice into the
// credit effect ADR-067 assigns it: a normal-period grant, upgrade top-up
// credits, or administrator attention. It is pure: callers decode the event
// (DecodeEvent), read every line page and supply the Price-to-tier map.
package invoice

import (
	"errors"
	"fmt"
)

// Period is a Stripe service period in Unix seconds.
type Period struct {
	Start, End int64
}

// Line is one invoice line, normalized across supported API versions.
// SubscriptionID/SubscriptionItemID are empty for a line that is not a
// subscription item.
type Line struct {
	ID                 string
	SubscriptionID     string
	SubscriptionItemID string
	PriceID            string
	Proration          bool
	Amount             int64
	Period             Period
}

// Invoice is a paid invoice, normalized across supported API versions.
// LinesComplete is false while Stripe holds further line pages unread.
type Invoice struct {
	ID             string
	BillingReason  string
	SubscriptionID string
	CustomerID     string
	// AmountPaid is in the currency's smallest unit; zero for a free period.
	AmountPaid int64
	// MetadataUserID is enx_user_id in the invoice's snapshot of its
	// subscription's metadata, which ENX's Checkout sets server-side; "" for
	// a subscription created without it.
	MetadataUserID string
	Lines          []Line
	LinesComplete  bool
}

// Kind is the credit effect of a paid subscription invoice.
type Kind int

const (
	NeedsAttention Kind = iota
	// PeriodGrant resets the subscription pool to Tier's per-period credits
	// for Period, after ownership and acceptance checks.
	PeriodGrant
	// UpgradeTopUp adds upgrade top-up credits from FromTier to Tier; Period
	// is the positive proration line's, the share of the period left.
	UpgradeTopUp
)

// Reasons an invoice needs attention.
const (
	ReasonUnsupportedBillingReason = "unsupported_billing_reason"
	ReasonUnknownPrice             = "unknown_price"
	ReasonAmbiguousLines           = "ambiguous_lines"
	ReasonLinesIncomplete          = "lines_incomplete"
)

// Classification is what Classify decided. Reason is set only for
// NeedsAttention.
type Classification struct {
	Kind               Kind
	Reason             string
	SubscriptionID     string
	SubscriptionItemID string
	FromTier           string
	Tier               string
	Period             Period
}

func attention(reason string) Classification {
	return Classification{Kind: NeedsAttention, Reason: reason}
}

// Classify applies ADR-067 §积分随 Stripe 事件调整. subscription_create and
// subscription_cycle grant the tier of the one non-proration line;
// subscription_update is an upgrade top-up from the negative to the positive
// proration line's Price, or a normal grant when it carries exactly one
// non-proration line and no proration (a Subscription Schedule phase change).
// Every line must belong to one item of the invoice's subscription. Anything
// else, and any Price outside tierForPrice, needs attention. Line order,
// invoice totals and today's subscription Price never decide.
func Classify(inv Invoice, tierForPrice map[string]string) Classification {
	switch inv.BillingReason {
	case "subscription_create", "subscription_cycle", "subscription_update":
	default:
		return attention(ReasonUnsupportedBillingReason)
	}
	if !inv.LinesComplete {
		return attention(ReasonLinesIncomplete)
	}
	if inv.SubscriptionID == "" || len(inv.Lines) == 0 {
		return attention(ReasonAmbiguousLines)
	}
	item := inv.Lines[0].SubscriptionItemID
	var recurring, credit, debit []Line
	for _, l := range inv.Lines {
		if l.SubscriptionID != inv.SubscriptionID || l.SubscriptionItemID == "" || l.SubscriptionItemID != item {
			return attention(ReasonAmbiguousLines)
		}
		switch {
		case !l.Proration:
			recurring = append(recurring, l)
		case l.Amount < 0:
			credit = append(credit, l)
		case l.Amount > 0:
			debit = append(debit, l)
		default:
			return attention(ReasonAmbiguousLines)
		}
	}

	if len(recurring) == 1 && len(credit) == 0 && len(debit) == 0 {
		tier, ok := tierForPrice[recurring[0].PriceID]
		if !ok {
			return attention(ReasonUnknownPrice)
		}
		return Classification{Kind: PeriodGrant, SubscriptionID: inv.SubscriptionID, SubscriptionItemID: item, Tier: tier, Period: recurring[0].Period}
	}
	if inv.BillingReason == "subscription_update" && len(recurring) == 0 && len(credit) == 1 && len(debit) == 1 {
		from, okFrom := tierForPrice[credit[0].PriceID]
		to, okTo := tierForPrice[debit[0].PriceID]
		if !okFrom || !okTo {
			return attention(ReasonUnknownPrice)
		}
		return Classification{Kind: UpgradeTopUp, SubscriptionID: inv.SubscriptionID, SubscriptionItemID: item, FromTier: from, Tier: to, Period: debit[0].Period}
	}
	return attention(ReasonAmbiguousLines)
}

var (
	// ErrUpgradeNotHigher: the new tier's credits are not above the old
	// tier's, e.g. an immediate downgrade from configuration drift. Nothing is
	// granted or deducted; the invoice needs attention.
	ErrUpgradeNotHigher = errors.New("billing/invoice: upgrade target tier grants no more credits")
	// ErrGrantPeriodMismatch: the denominator is not the stored normal grant
	// of the period the proration line ends with.
	ErrGrantPeriodMismatch = errors.New("billing/invoice: normal grant period does not match the upgrade line")
)

// UpgradeTopUpCredits is floor((toCredits - fromCredits) * share), share
// being clamp(line length / grant period length, 0, 1). grant is the stored
// normal grant of the same subscription whose period ends where line ends:
// never the live subscription item's period or proration_details.
func UpgradeTopUpCredits(fromCredits, toCredits int64, line, grant Period) (int64, error) {
	if toCredits <= fromCredits {
		return 0, fmt.Errorf("%w: %d -> %d", ErrUpgradeNotHigher, fromCredits, toCredits)
	}
	if grant.End <= grant.Start || grant.End != line.End {
		return 0, fmt.Errorf("%w: grant %v, line %v", ErrGrantPeriodMismatch, grant, line)
	}
	remaining := min(max(line.End-line.Start, 0), grant.End-grant.Start)
	return (toCredits - fromCredits) * remaining / (grant.End - grant.Start), nil
}
