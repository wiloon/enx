// Package adapters backs entitlement.Source with the billing tables.
package adapters

import (
	"context"
	"errors"

	"enx-api/billing/credit"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// Billing reads subscriptions and credit_accounts.
type Billing struct{}

// IsActiveSubscriber reports whether userID has a subscription whose status
// is "active" (the same rule dictionary uses for its quota tiers).
func (Billing) IsActiveSubscriber(ctx context.Context, userID string) (bool, error) {
	var count int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.Subscription{}).
		Where("user_id = ? AND status = ?", userID, "active").
		Count(&count).Error
	return count > 0, err
}

// TopupBalance returns userID's top-up credit balance; a user with no credit
// account has none.
func (Billing) TopupBalance(ctx context.Context, userID string) (int64, error) {
	var account sqlitex.CreditAccount
	err := sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return account.TopupBalance, nil
}

// TrialBalance returns userID's spendable sign-up trial credit (ADR-048).
func (Billing) TrialBalance(ctx context.Context, userID string) (int64, error) {
	balance, _, err := credit.Trial(ctx, userID)
	return balance, err
}
