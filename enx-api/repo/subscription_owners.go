package repo

import (
	"context"
	"fmt"

	"enx-api/billing/deletion"
	"enx-api/billing/eligibility"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// SubscriptionOwners is deletion.Store over the user's subscriptions rows.
type SubscriptionOwners struct{}

var _ deletion.Store = SubscriptionOwners{}

// OwnedSubscriptions reads every subscription userID owns in one read
// transaction, with the same conflict mapping as PortalSessionOwners.
func (SubscriptionOwners) OwnedSubscriptions(ctx context.Context, userID string) ([]eligibility.Owned, error) {
	var owned []eligibility.Owned
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		owned, err = ownedSubscriptions(tx, userID)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("read subscriptions owned by %s: %w", userID, err)
	}
	return owned, nil
}
