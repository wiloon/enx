package credit

import (
	"context"
	"errors"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// Balance returns userID's total spendable credit -- the sum of the
// subscription and top-up pools. Token-metered features (ADR-012) call it
// before invoking the AI provider and reject the request with 402 when it
// is below 1. The value can be negative: a Settle whose actual token cost
// overran the top-up pool leaves it there until the next top-up.
//
// A user with no credit_accounts row yet has a zero balance; Balance does
// not create the row (it is a read).
func Balance(ctx context.Context, userID string) (int64, error) {
	var account sqlitex.CreditAccount
	err := sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return account.SubscriptionBalance + account.TopupBalance, nil
}
