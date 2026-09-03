// Package credit implements the two-pool AI credit ledger: atomic
// consumption (subscription pool first, then top-up pool) and the two grant
// paths triggered by Stripe webhooks. See
// docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §2 (ledger.go
// signatures) and
// docs/architecture/adr-009-billing-stripe-subscription-and-ai-credits.md
// Decision 5 (atomic conditional-update scheme) for the design this
// implements.
package credit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ErrInsufficientCredit is returned by Consume when neither the
// subscription nor the top-up pool covers cost. Callers should map this to
// HTTP 402.
var ErrInsufficientCredit = errors.New("credit: insufficient balance")

const (
	TypeGrantSubscription = "GRANT_SUBSCRIPTION"
	TypeGrantTopup        = "GRANT_TOPUP"
	TypeConsume           = "CONSUME"
	TypeRefund            = "REFUND"
	TypeExpire            = "EXPIRE"
	// TypeSettle marks a Settle row: a post-hoc deduction for a
	// token-metered feature whose AI call already completed (ADR-012).
	// Distinct from TypeConsume so accounting can tell "charged after the
	// fact, may have gone negative" from "checked-then-charged".
	TypeSettle = "SETTLE"
)

// Pool identifies which balance a Consume call drew from, so a caller whose
// downstream operation then fails can Refund the exact same pool (see
// TASK-SPEC §4.1's "AI provider 调用失败时...已扣积分被退回").
const (
	PoolSubscription = "subscription_balance"
	PoolTopup        = "topup_balance"
)

// Consume deducts cost credits for feature, trying the subscription pool
// first and falling back to the top-up pool (ADR-009 Decision 5). The
// balance check and deduction happen in one SQLite transaction via a
// conditional UPDATE ("WHERE ... balance >= cost"), so concurrent callers
// for the same user cannot overspend -- see ConsumeConcurrency test. On
// success, pool reports which balance was drawn from (see Refund).
func Consume(ctx context.Context, userID, feature string, cost int64) (pool string, err error) {
	if cost <= 0 {
		return "", fmt.Errorf("credit: cost must be positive, got %d", cost)
	}

	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UnixMilli()
		if err := ensureAccount(tx, userID, now); err != nil {
			return err
		}

		if ok, balanceAfter, err := deductSubscriptionBalance(tx, userID, cost, now); err != nil {
			return err
		} else if ok {
			pool = PoolSubscription
			return insertLedgerRow(tx, sqlitex.CreditTransaction{
				Id:           uuid.New().String(),
				UserId:       userID,
				Type:         TypeConsume,
				Amount:       -cost,
				BalanceAfter: balanceAfter,
				Feature:      feature,
				CreatedAt:    now,
			})
		}

		if ok, balanceAfter, err := deductTopupBalance(tx, userID, cost, now); err != nil {
			return err
		} else if ok {
			pool = PoolTopup
			return insertLedgerRow(tx, sqlitex.CreditTransaction{
				Id:           uuid.New().String(),
				UserId:       userID,
				Type:         TypeConsume,
				Amount:       -cost,
				BalanceAfter: balanceAfter,
				Feature:      feature,
				CreatedAt:    now,
			})
		}

		return ErrInsufficientCredit
	})
	if err != nil {
		return "", err
	}
	return pool, nil
}

// Refund credits cost back into pool (whichever Consume reported drawing
// from) and records a REFUND ledger row. Used when a Consume succeeded but
// the AI provider call that followed it then failed (TASK-SPEC §4.1): the
// user shouldn't be charged for a call that never produced a result.
func Refund(ctx context.Context, userID, feature, pool string, cost int64) error {
	if cost <= 0 {
		return fmt.Errorf("credit: refund cost must be positive, got %d", cost)
	}
	if pool != PoolSubscription && pool != PoolTopup {
		return fmt.Errorf("credit: unknown pool %q", pool)
	}

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UnixMilli()
		if err := ensureAccount(tx, userID, now); err != nil {
			return err
		}

		column := "subscription_balance"
		if pool == PoolTopup {
			column = "topup_balance"
		}
		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				column:       gorm.Expr(column+" + ?", cost),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}

		var account sqlitex.CreditAccount
		if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}
		balanceAfter := account.SubscriptionBalance
		if pool == PoolTopup {
			balanceAfter = account.TopupBalance
		}

		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:           uuid.New().String(),
			UserId:       userID,
			Type:         TypeRefund,
			Amount:       cost,
			BalanceAfter: balanceAfter,
			Feature:      feature,
			CreatedAt:    now,
		})
	})
}

// GrantSubscription is called from the invoice.paid webhook: it replaces
// (not adds to) subscription_balance with amount, since unused subscription
// credit doesn't carry over month to month (ADR-009 Decision 5/D2), and
// advances period_end. Idempotent on stripeEventID: a Stripe webhook retry
// for an event already recorded in credit_transactions is a no-op.
func GrantSubscription(ctx context.Context, userID string, amount int64, periodEnd time.Time, stripeEventID string) error {
	if stripeEventID == "" {
		return fmt.Errorf("credit: GrantSubscription requires a non-empty stripeEventID")
	}
	if amount <= 0 {
		// Deliberately fail closed rather than silently reset a paying
		// subscriber's balance to 0: an amount of 0 here almost always
		// means stripe.credits.subscription-{pro,pro-plus,max} hasn't been
		// configured yet (see config.toml's placeholder comment), which
		// should surface as a webhook failure Stripe retries and an
		// operator notices, not a quiet under-grant.
		return fmt.Errorf("credit: GrantSubscription amount must be positive, got %d", amount)
	}

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		already, err := eventAlreadyProcessed(tx, stripeEventID)
		if err != nil || already {
			return err
		}

		now := time.Now().UnixMilli()
		if err := ensureAccount(tx, userID, now); err != nil {
			return err
		}

		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"subscription_balance": amount,
				"period_end":           periodEnd.Unix(),
				"updated_at":           now,
			}).Error; err != nil {
			return err
		}

		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:            uuid.New().String(),
			UserId:        userID,
			Type:          TypeGrantSubscription,
			Amount:        amount,
			BalanceAfter:  amount,
			StripeEventId: &stripeEventID,
			CreatedAt:     now,
		})
	})
}

// GrantTopup is called from the checkout.session.completed webhook for a
// top-up purchase: it adds amount to topup_balance, which never expires
// (ADR-009 Decision 5/D2). Idempotent on stripeEventID, same as
// GrantSubscription.
func GrantTopup(ctx context.Context, userID string, amount int64, stripeEventID string) error {
	if stripeEventID == "" {
		return fmt.Errorf("credit: GrantTopup requires a non-empty stripeEventID")
	}
	if amount <= 0 {
		return fmt.Errorf("credit: GrantTopup amount must be positive, got %d", amount)
	}

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		already, err := eventAlreadyProcessed(tx, stripeEventID)
		if err != nil || already {
			return err
		}

		now := time.Now().UnixMilli()
		if err := ensureAccount(tx, userID, now); err != nil {
			return err
		}

		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"topup_balance": gorm.Expr("topup_balance + ?", amount),
				"updated_at":    now,
			}).Error; err != nil {
			return err
		}

		var account sqlitex.CreditAccount
		if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}

		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:            uuid.New().String(),
			UserId:        userID,
			Type:          TypeGrantTopup,
			Amount:        amount,
			BalanceAfter:  account.TopupBalance,
			StripeEventId: &stripeEventID,
			CreatedAt:     now,
		})
	})
}

// ensureAccount creates a zero-balance credit_accounts row for userID if
// one doesn't exist yet, so the conditional UPDATEs below always have a row
// to match against.
func ensureAccount(tx *gorm.DB, userID string, now int64) error {
	return tx.Where(sqlitex.CreditAccount{UserId: userID}).
		Attrs(sqlitex.CreditAccount{UpdatedAt: now}).
		FirstOrCreate(&sqlitex.CreditAccount{}).Error
}

// deductSubscriptionBalance attempts the conditional UPDATE ... WHERE
// subscription_balance >= cost. ok is false (no error) when the balance was
// insufficient -- that's the expected "try the other pool" signal, not a
// failure.
func deductSubscriptionBalance(tx *gorm.DB, userID string, cost, now int64) (ok bool, balanceAfter int64, err error) {
	result := tx.Model(&sqlitex.CreditAccount{}).
		Where("user_id = ? AND subscription_balance >= ?", userID, cost).
		Updates(map[string]interface{}{
			"subscription_balance": gorm.Expr("subscription_balance - ?", cost),
			"updated_at":           now,
		})
	if result.Error != nil {
		return false, 0, result.Error
	}
	if result.RowsAffected == 0 {
		return false, 0, nil
	}
	var account sqlitex.CreditAccount
	if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
		return false, 0, err
	}
	return true, account.SubscriptionBalance, nil
}

// deductTopupBalance is deductSubscriptionBalance's twin for the top-up pool.
func deductTopupBalance(tx *gorm.DB, userID string, cost, now int64) (ok bool, balanceAfter int64, err error) {
	result := tx.Model(&sqlitex.CreditAccount{}).
		Where("user_id = ? AND topup_balance >= ?", userID, cost).
		Updates(map[string]interface{}{
			"topup_balance": gorm.Expr("topup_balance - ?", cost),
			"updated_at":    now,
		})
	if result.Error != nil {
		return false, 0, result.Error
	}
	if result.RowsAffected == 0 {
		return false, 0, nil
	}
	var account sqlitex.CreditAccount
	if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
		return false, 0, err
	}
	return true, account.TopupBalance, nil
}

func eventAlreadyProcessed(tx *gorm.DB, stripeEventID string) (bool, error) {
	var count int64
	if err := tx.Model(&sqlitex.CreditTransaction{}).
		Where("stripe_event_id = ?", stripeEventID).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func insertLedgerRow(tx *gorm.DB, txn sqlitex.CreditTransaction) error {
	return tx.Create(&txn).Error
}
