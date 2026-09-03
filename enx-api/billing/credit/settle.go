package credit

import (
	"context"
	"fmt"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Settle deducts cost credits for a token-metered feature (ADR-012) after
// its AI call has already happened. Unlike Consume it does not check
// affordability: the subscription pool is drawn down first (never below
// zero), and whatever cost remains comes out of the top-up pool, which is
// allowed to go negative. The next request's Balance pre-check is what then
// stops the user until they top up.
func Settle(ctx context.Context, userID, feature string, cost int64) error {
	if cost < 0 {
		return fmt.Errorf("credit: settle cost must not be negative, got %d", cost)
	}
	if cost == 0 {
		return nil
	}

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UnixMilli()
		if err := ensureAccount(tx, userID, now); err != nil {
			return err
		}

		// One atomic UPDATE so the "subscription to zero, top-up absorbs the
		// rest" split holds under concurrency: SQL evaluates every RHS
		// against the row's pre-update values, so two racing Settles can't
		// both decide to take the same credits from the subscription pool
		// and drive it negative (which GrantSubscription's replace-semantics
		// would then silently forgive).
		//   taken_from_subscription = min(max(subscription_balance,0), cost)
		//   subscription_balance   -> max(0, subscription_balance - cost)
		//   topup_balance          -> topup_balance - (cost - taken_from_subscription)
		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"topup_balance": gorm.Expr(
					"topup_balance - (? - MIN(MAX(subscription_balance, 0), ?))", cost, cost),
				"subscription_balance": gorm.Expr("MAX(0, subscription_balance - ?)", cost),
				"updated_at":           now,
			}).Error; err != nil {
			return err
		}

		var account sqlitex.CreditAccount
		if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}

		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:           uuid.New().String(),
			UserId:       userID,
			Type:         TypeSettle,
			Amount:       -cost,
			BalanceAfter: account.SubscriptionBalance + account.TopupBalance,
			Feature:      feature,
			CreatedAt:    now,
		})
	})
}
