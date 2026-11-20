package credit

import (
	"context"
	"errors"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// Pools returns the three credit pools for /billing/me from one
// credit_accounts read (ADR-052 Decision 2b). The trial pool is at its
// effective value (ADR-048 Decision 8). A missing row is zeros with no
// error; any other read error is returned.
func Pools(ctx context.Context, userID string) (subscription, topup, trial int64, expiresAt time.Time, err error) {
	var account sqlitex.CreditAccount
	err = sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, 0, 0, time.Time{}, nil
	}
	if err != nil {
		return 0, 0, 0, time.Time{}, err
	}
	if account.TrialExpiresAt != nil {
		expiresAt = time.Unix(*account.TrialExpiresAt, 0)
	}
	return account.SubscriptionBalance, account.TopupBalance, effectiveTrial(account, now()), expiresAt, nil
}
