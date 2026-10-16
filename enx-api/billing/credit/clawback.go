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

// TypeClawback marks credits taken back because the payment that bought
// them was refunded in Stripe (ADR-049 Decision 7). Amount is negative, like
// SETTLE. Not REFUND: that type gives credits back after a failed AI call.
const TypeClawback = "CLAWBACK"

// ErrGrantNotFound is returned by Clawback when no grant recorded the
// refunded payment intent; nothing is taken.
var ErrGrantNotFound = errors.New("credit: no grant for this payment intent")

// ClawbackResult says what a Clawback took and from which grant, so the
// webhook can decide whether the refund also cancels a subscription.
type ClawbackResult struct {
	UserID    string
	GrantType string // TypeGrantTopup or TypeGrantSubscription
	Amount    int64  // credits taken by this call, >= 0
}

// Clawback takes back the credits a refunded payment bought.
// amountRefunded is Stripe's cumulative charge.amount_refunded and
// amountCaptured its charge.amount_captured, both in the smallest currency
// unit.
func Clawback(ctx context.Context, paymentIntentID string, amountRefunded, amountCaptured int64, stripeEventID string) (ClawbackResult, error) {
	if amountCaptured <= 0 || amountRefunded < 0 || amountRefunded > amountCaptured {
		return ClawbackResult{}, fmt.Errorf("credit: Clawback(%s): refunded %d of captured %d is not a valid refund", paymentIntentID, amountRefunded, amountCaptured)
	}

	var result ClawbackResult
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var grant sqlitex.CreditTransaction
		err := tx.Where("stripe_payment_intent_id = ?", paymentIntentID).First(&grant).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrGrantNotFound
		}
		if err != nil {
			return err
		}
		result = ClawbackResult{UserID: grant.UserId, GrantType: grant.Type}

		already, err := eventAlreadyProcessed(tx, stripeEventID)
		if err != nil || already {
			return err
		}

		// amount_refunded is cumulative, so this refund takes what the total
		// so far owes minus what earlier clawbacks of this grant already took.
		var taken int64
		if err := tx.Model(&sqlitex.CreditTransaction{}).
			Where("related_transaction_id = ? AND type = ?", grant.Id, TypeClawback).
			Select("COALESCE(-SUM(amount), 0)").Scan(&taken).Error; err != nil {
			return err
		}
		// Never below zero: Stripe may deliver an earlier, smaller refund's
		// event after a later one, and that must not hand credits back.
		owed := max(grant.Amount*amountRefunded/amountCaptured-taken, 0)

		var account sqlitex.CreditAccount
		if err := tx.Where("user_id = ?", grant.UserId).First(&account).Error; err != nil {
			return err
		}

		// A top-up refund may take the top-up pool negative, like Settle. A
		// subscription refund only touches the pool while that grant is the
		// current period's, and stops at zero.
		pool, take := PoolTopup, owed
		if grant.Type == TypeGrantSubscription {
			var latest sqlitex.CreditTransaction
			if err := tx.Where("user_id = ? AND type = ?", grant.UserId, TypeGrantSubscription).
				Order("created_at DESC, rowid DESC").First(&latest).Error; err != nil {
				return err
			}
			pool, take = PoolSubscription, 0
			if latest.Id == grant.Id {
				take = min(owed, max(account.SubscriptionBalance, 0))
			}
		}

		now := time.Now().UnixMilli()
		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", grant.UserId).
			Updates(map[string]interface{}{
				pool:         gorm.Expr(pool+" - ?", take),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		balanceAfter := account.TopupBalance - take
		if pool == PoolSubscription {
			balanceAfter = account.SubscriptionBalance - take
		}
		result.Amount = take

		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:                   uuid.New().String(),
			UserId:               grant.UserId,
			Type:                 TypeClawback,
			Amount:               -take,
			BalanceAfter:         balanceAfter,
			StripeEventId:        &stripeEventID,
			RelatedTransactionId: &grant.Id,
			CreatedAt:            now,
		})
	})
	if err != nil {
		return ClawbackResult{}, fmt.Errorf("credit: Clawback(%s): %w", paymentIntentID, err)
	}
	return result, nil
}
