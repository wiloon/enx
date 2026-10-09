package credit

import (
	"context"
	"fmt"

	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Settle deducts cost credits for a token-metered feature (ADR-012) after
// its AI call has already happened. Unlike Consume it does not check
// affordability: the unexpired trial pool is drawn down first, then the
// subscription pool (neither below zero, ADR-048 Decision 4), and whatever
// cost remains comes out of the top-up pool, which is allowed to go
// negative. The next request's Balance pre-check is what then stops the user
// until they top up.
func Settle(ctx context.Context, userID, feature string, cost int64) error {
	if cost < 0 {
		return fmt.Errorf("credit: settle cost must not be negative, got %d", cost)
	}
	if cost == 0 {
		return nil
	}

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		at := now()
		nowMs := at.UnixMilli()
		if err := ensureAccount(tx, userID, nowMs); err != nil {
			return err
		}
		if err := expireTrial(tx, userID, at); err != nil {
			return err
		}

		// One atomic UPDATE so the "trial, then subscription, each to zero,
		// top-up absorbs the rest" split holds under concurrency: SQL
		// evaluates every RHS against the row's pre-update values, so two
		// racing Settles can't both decide to take the same credits from a
		// non-negative pool and drive it negative (which GrantSubscription's
		// replace-semantics would then silently forgive).
		//   from_trial        = min(effective_trial, cost)
		//   rest              = cost - from_trial
		//   from_subscription = min(max(subscription_balance,0), rest)
		//   trial_balance        -> trial_balance - from_trial
		//   subscription_balance -> max(0, subscription_balance - rest)
		//   topup_balance        -> topup_balance - (rest - from_subscription)
		effTrial := "(CASE WHEN trial_expires_at > ? THEN MAX(trial_balance, 0) ELSE 0 END)"
		fromTrial := "MIN(" + effTrial + ", ?)"
		rest := "(? - " + fromTrial + ")"
		nowSec := at.Unix()
		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"topup_balance": gorm.Expr(
					"topup_balance - ("+rest+" - MIN(MAX(subscription_balance, 0), "+rest+"))",
					cost, nowSec, cost, cost, nowSec, cost),
				"subscription_balance": gorm.Expr("MAX(0, subscription_balance - "+rest+")", cost, nowSec, cost),
				"trial_balance":        gorm.Expr("trial_balance - "+fromTrial, nowSec, cost),
				"updated_at":           nowMs,
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
			BalanceAfter: account.SubscriptionBalance + account.TopupBalance + effectiveTrial(account, at),
			Feature:      feature,
			CreatedAt:    nowMs,
		})
	})
}
