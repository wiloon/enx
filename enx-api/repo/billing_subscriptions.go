package repo

import (
	"context"
	"fmt"

	"enx-api/billing/subscription"
	"enx-api/utils/sqlitex"
)

// BillingSubscriptions reads /billing/me's stored display from the
// Subscription-ID-keyed schema when billing cutover is enabled.
type BillingSubscriptions struct{}

var _ subscription.Reader = BillingSubscriptions{}

func (BillingSubscriptions) Subscription(ctx context.Context, userID string) (subscription.Snapshot, error) {
	var rows []subscription.Snapshot
	err := sqlitex.DB.WithContext(ctx).Raw("SELECT s.status, s.plan, s.current_period_end FROM users u "+
		"JOIN subscriptions s ON s.stripe_subscription_id = u.accepted_subscription_id AND s.user_id = u.id "+
		"WHERE u.id = ?", userID).Scan(&rows).Error
	if err != nil {
		return subscription.Snapshot{}, fmt.Errorf("read billing subscription for %s: %w", userID, err)
	}
	if len(rows) == 0 {
		return subscription.Snapshot{Status: "none"}, nil
	}
	return rows[0], nil
}
