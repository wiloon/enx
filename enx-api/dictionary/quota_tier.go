package dictionary

import (
	"context"
	"fmt"
)

// QuotaTier is the daily lookup quota's tier (ADR-093).
type QuotaTier int

const (
	// TierUnknown is a tier that could not be decided because a read failed.
	// Each caller decides what that means for it.
	TierUnknown QuotaTier = iota
	TierFree
	TierPaid
)

// QuotaTierSource reads what decides a user's quota tier:
// entitlement/adapters.Billing in production.
type QuotaTierSource interface {
	// IsActiveSubscriber reports whether the user has an active accepted
	// subscription.
	IsActiveSubscriber(ctx context.Context, userID string) (bool, error)
	// TopupBalance is the user's top-up credit pool balance, which can be
	// negative. The trial pool is not part of it.
	TopupBalance(ctx context.Context, userID string) (int64, error)
}

// QuotaTierOf decides userID's quota tier: paid with an active accepted
// subscription or a top-up balance above 0, free otherwise (ADR-093). A
// subscriber's balance is not read. When a read fails it returns TierUnknown
// and the error.
func QuotaTierOf(ctx context.Context, source QuotaTierSource, userID string) (QuotaTier, error) {
	subscribed, err := source.IsActiveSubscriber(ctx, userID)
	if err != nil {
		return TierUnknown, fmt.Errorf("read subscription: %w", err)
	}
	if subscribed {
		return TierPaid, nil
	}
	topup, err := source.TopupBalance(ctx, userID)
	if err != nil {
		return TierUnknown, fmt.Errorf("read top-up balance: %w", err)
	}
	if topup > 0 {
		return TierPaid, nil
	}
	return TierFree, nil
}
