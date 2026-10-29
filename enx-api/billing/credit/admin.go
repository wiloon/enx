package credit

import (
	"context"
	"fmt"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Ledger types for an admin's manual changes (ADR-049 Decision 2/3). Kept
// apart from GRANT_TOPUP so "credits users paid for" is never mixed with
// comps and corrections.
const (
	TypeGrantAdmin = "GRANT_ADMIN"
	// TypeDeductAdmin rows carry a negative Amount, like SETTLE.
	TypeDeductAdmin = "DEDUCT_ADMIN"
)

// GrantAdmin adds amount to userID's top-up pool (never expires) on an
// admin's behalf; note records the admin's reason and is required.
func GrantAdmin(ctx context.Context, userID string, amount int64, note string) error {
	if amount <= 0 {
		return fmt.Errorf("credit: GrantAdmin amount must be positive, got %d", amount)
	}
	if note == "" {
		return fmt.Errorf("credit: GrantAdmin requires a reason")
	}
	return adjustTopup(ctx, userID, amount, TypeGrantAdmin, note)
}

// DeductAdmin takes amount from userID's top-up pool on an admin's behalf,
// e.g. to correct a mistaken grant. Like Settle it may leave the pool
// negative, which turns AI off until the user tops up again.
func DeductAdmin(ctx context.Context, userID string, amount int64, note string) error {
	if amount <= 0 {
		return fmt.Errorf("credit: DeductAdmin amount must be positive, got %d", amount)
	}
	if note == "" {
		return fmt.Errorf("credit: DeductAdmin requires a reason")
	}
	return adjustTopup(ctx, userID, -amount, TypeDeductAdmin, note)
}

// adjustTopup adds delta (negative to deduct) to the top-up pool and writes
// the ledger row in the same transaction.
func adjustTopup(ctx context.Context, userID string, delta int64, txnType, note string) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := checkGrantTarget(tx, userID); err != nil {
			return err
		}

		now := time.Now().UnixMilli()
		if err := ensureAccount(tx, userID, now); err != nil {
			return err
		}

		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"topup_balance": gorm.Expr("topup_balance + ?", delta),
				"updated_at":    now,
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
			Type:         txnType,
			Amount:       delta,
			BalanceAfter: account.TopupBalance,
			Note:         note,
			CreatedAt:    now,
		})
	})
}
