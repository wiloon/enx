package invoice

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrUnsupportedAPIVersion: the event's api_version has no adapter here;
	// the event needs attention rather than a guess at its schema.
	ErrUnsupportedAPIVersion = errors.New("billing/invoice: unsupported Stripe API version")
	// ErrNotAnInvoiceEvent: the event does not carry an invoice.
	ErrNotAnInvoiceEvent = errors.New("billing/invoice: not an invoice event")
)

// dahliaVersions share one invoice shape: lines name their subscription item
// under parent.subscription_item_details and their Price under
// pricing.price_details. 2026-08-26 is stripe-go v86.4.2's pinned version;
// 2026-07-29 is what the Sandbox endpoint delivered for the fixtures.
var dahliaVersions = map[string]bool{
	"2026-07-29.dahlia": true,
	"2026-08-26.dahlia": true,
}

type dahliaEvent struct {
	APIVersion string `json:"api_version"`
	Type       string `json:"type"`
	Data       struct {
		Object dahliaInvoice `json:"object"`
	} `json:"data"`
}

type dahliaInvoice struct {
	ID            string `json:"id"`
	Object        string `json:"object"`
	BillingReason string `json:"billing_reason"`
	Parent        *struct {
		SubscriptionDetails *struct {
			Subscription string `json:"subscription"`
		} `json:"subscription_details"`
	} `json:"parent"`
	Lines struct {
		Data []struct {
			ID     string `json:"id"`
			Amount int64  `json:"amount"`
			Parent *struct {
				SubscriptionItemDetails *struct {
					Proration        bool   `json:"proration"`
					Subscription     string `json:"subscription"`
					SubscriptionItem string `json:"subscription_item"`
				} `json:"subscription_item_details"`
			} `json:"parent"`
			Period struct {
				Start int64 `json:"start"`
				End   int64 `json:"end"`
			} `json:"period"`
			Pricing *struct {
				PriceDetails *struct {
					Price string `json:"price"`
				} `json:"price_details"`
			} `json:"pricing"`
		} `json:"data"`
		HasMore bool `json:"has_more"`
	} `json:"lines"`
}

// DecodeEvent reads an invoice event's raw payload with the adapter for its
// api_version, never the current SDK's schema.
func DecodeEvent(payload []byte) (Invoice, error) {
	var head struct {
		APIVersion string `json:"api_version"`
		Type       string `json:"type"`
	}
	if err := json.Unmarshal(payload, &head); err != nil {
		return Invoice{}, fmt.Errorf("billing/invoice: decode event: %w", err)
	}
	if !strings.HasPrefix(head.Type, "invoice.") {
		return Invoice{}, fmt.Errorf("%w: %s", ErrNotAnInvoiceEvent, head.Type)
	}
	if !dahliaVersions[head.APIVersion] {
		return Invoice{}, fmt.Errorf("%w: %q", ErrUnsupportedAPIVersion, head.APIVersion)
	}

	var e dahliaEvent
	if err := json.Unmarshal(payload, &e); err != nil {
		return Invoice{}, fmt.Errorf("billing/invoice: decode %s invoice: %w", e.APIVersion, err)
	}
	src := e.Data.Object
	if src.Object != "invoice" {
		return Invoice{}, fmt.Errorf("%w: object %q", ErrNotAnInvoiceEvent, src.Object)
	}
	inv := Invoice{ID: src.ID, BillingReason: src.BillingReason, LinesComplete: !src.Lines.HasMore}
	if src.Parent != nil && src.Parent.SubscriptionDetails != nil {
		inv.SubscriptionID = src.Parent.SubscriptionDetails.Subscription
	}
	for _, l := range src.Lines.Data {
		line := Line{ID: l.ID, Amount: l.Amount, Period: Period{Start: l.Period.Start, End: l.Period.End}}
		if l.Parent != nil && l.Parent.SubscriptionItemDetails != nil {
			d := l.Parent.SubscriptionItemDetails
			line.SubscriptionID, line.SubscriptionItemID, line.Proration = d.Subscription, d.SubscriptionItem, d.Proration
		}
		if l.Pricing != nil && l.Pricing.PriceDetails != nil {
			line.PriceID = l.Pricing.PriceDetails.Price
		}
		inv.Lines = append(inv.Lines, line)
	}
	return inv, nil
}
