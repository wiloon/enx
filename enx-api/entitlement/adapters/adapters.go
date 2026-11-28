// Package adapters backs entitlement.Source with the billing tables.
package adapters

import (
	"context"
	"errors"

	"enx-api/billing/credit"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// SubscriptionReader reports whether a user has an active subscription.
type SubscriptionReader interface {
	IsActiveSubscriber(context.Context, string) (bool, error)
}

// Billing reads subscriptions and credit_accounts. Only TopupBalance uses the
// handle given to NewBilling: TrialBalance and IsActiveSubscriber still reach
// the global database through billing/credit and repo.
type Billing struct {
	db            *gorm.DB
	Subscriptions SubscriptionReader
}

// NewBilling returns a Billing that reads credit_accounts from db. With nil
// subscriptions, IsActiveSubscriber reads the accepted subscription itself.
func NewBilling(db *gorm.DB, subscriptions SubscriptionReader) Billing {
	return Billing{db: db, Subscriptions: subscriptions}
}

// IsActiveSubscriber reports whether userID has a subscription whose status
// is "active". Billing is also dictionary's quota tier source (ADR-093).
func (b Billing) IsActiveSubscriber(ctx context.Context, userID string) (bool, error) {
	if b.Subscriptions != nil {
		return b.Subscriptions.IsActiveSubscriber(ctx, userID)
	}
	return (repo.AcceptedSubscriptions{}).IsActiveSubscriber(ctx, userID)
}

// TopupBalance returns userID's top-up credit balance; a user with no credit
// account has none.
func (b Billing) TopupBalance(ctx context.Context, userID string) (int64, error) {
	var account sqlitex.CreditAccount
	err := b.db.WithContext(ctx).Where("user_id = ?", userID).First(&account).Error
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
