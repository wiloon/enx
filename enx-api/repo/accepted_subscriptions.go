package repo

import (
	"context"
	"fmt"

	"enx-api/utils/sqlitex"
)

// AcceptedSubscriptions reads stored entitlement from the Subscription-ID-keyed
// schema. It is shared by entitlement's subscriber check and dictionary's quota
// tier at cutover; the legacy readers remain in use until then.
type AcceptedSubscriptions struct{}

// IsActiveSubscriber reports whether the user's current accepted subscription
// has stored status active. Other owned subscriptions confer no entitlement.
func (AcceptedSubscriptions) IsActiveSubscriber(ctx context.Context, userID string) (bool, error) {
	var count int64
	err := sqlitex.DB.WithContext(ctx).Raw("SELECT COUNT(*) FROM users u "+
		"JOIN subscriptions s ON s.stripe_subscription_id = u.accepted_subscription_id AND s.user_id = u.id "+
		"WHERE u.id = ? AND s.status = 'active'", userID).Scan(&count).Error
	if err != nil {
		return false, fmt.Errorf("read accepted subscription entitlement for %s: %w", userID, err)
	}
	return count > 0, nil
}
