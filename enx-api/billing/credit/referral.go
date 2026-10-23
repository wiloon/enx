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

const (
	// TypeGrantReferralBonus marks the invitee's bonus for claiming an
	// invite, added to the trial pool (ADR-051 Decision 4).
	TypeGrantReferralBonus = "GRANT_REFERRAL_BONUS"
	// TypeGrantReferralReward marks the referrer's reward for the invitee's
	// first payment, added to the top-up pool (ADR-051 Decision 5). Not
	// GRANT_TOPUP: the referrer bought nothing.
	TypeGrantReferralReward = "GRANT_REFERRAL_REWARD"
)

// ErrNoUser: the user has no users row (the account was deleted), so there
// is no account to credit.
var ErrNoUser = errors.New("credit: no such user")

// ReferralBonus is the invitee's claim grant.
type ReferralBonus struct {
	Amount int64
	// ExpiresAt is the earliest the trial may now expire; a later existing
	// expiry is kept, so a smaller configured TTL never shortens a trial.
	ExpiresAt time.Time
	// TrialAmount and TrialTTL are the ADR-048 trial, issued first when the
	// account never got it (e.g. its sign-up hook failed).
	TrialAmount int64
	TrialTTL    time.Duration
	// EmailHMAC is the invitee's email HMAC, for that trial's once-per-email
	// check (ADR-062); "" issues no trial.
	EmailHMAC string
}

// GrantReferralBonus adds b.Amount to userID's trial pool and moves its
// expiry to at least b.ExpiresAt, issuing a missing sign-up trial first,
// all in one transaction. Once per account: the ledger row's idempotency key
// is "referral-bonus:<userID>", so a replay changes nothing. It returns the
// trial's expiry after the call.
func GrantReferralBonus(ctx context.Context, userID string, b ReferralBonus) (trialExpiresAt time.Time, err error) {
	if b.Amount <= 0 {
		return time.Time{}, fmt.Errorf("credit: GrantReferralBonus amount must be positive, got %d", b.Amount)
	}
	key := "referral-bonus:" + userID

	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		at := now()
		already, err := eventAlreadyProcessed(tx, key)
		if err != nil {
			return err
		}
		if !already {
			if _, err := grantTrial(tx, userID, b.EmailHMAC, b.TrialAmount, b.TrialTTL, at); err != nil {
				return err
			}
		}

		nowMs := at.UnixMilli()
		if err := ensureAccount(tx, userID, nowMs); err != nil {
			return err
		}
		var account sqlitex.CreditAccount
		if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}
		expires := b.ExpiresAt.Unix()
		if account.TrialExpiresAt != nil && *account.TrialExpiresAt > expires {
			expires = *account.TrialExpiresAt
		}
		if already {
			if account.TrialExpiresAt != nil {
				trialExpiresAt = time.Unix(*account.TrialExpiresAt, 0)
			}
			return nil
		}
		trialExpiresAt = time.Unix(expires, 0)

		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"trial_balance":    gorm.Expr("trial_balance + ?", b.Amount),
				"trial_expires_at": expires,
				"updated_at":       nowMs,
			}).Error; err != nil {
			return err
		}
		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:            uuid.New().String(),
			UserId:        userID,
			Type:          TypeGrantReferralBonus,
			Amount:        b.Amount,
			BalanceAfter:  account.TrialBalance + b.Amount,
			StripeEventId: &key,
			CreatedAt:     nowMs,
		})
	})
	if err != nil {
		return time.Time{}, err
	}
	return trialExpiresAt, nil
}

// GrantReferralReward adds amount to the referrer's top-up pool, which never
// expires. Idempotent on key ("referral-reward:<inviteeID>"). The row
// deliberately carries no payment intent: ADR-049's Clawback finds grants
// by payment intent, and the invitee's later refund must not reach the
// referrer. A referrer with no users row gets ErrNoUser and nothing is
// written; the check runs inside the transaction so that it serializes with
// the account's deletion.
func GrantReferralReward(ctx context.Context, referrerID string, amount int64, key string) error {
	if key == "" {
		return fmt.Errorf("credit: GrantReferralReward requires a non-empty key")
	}
	if amount <= 0 {
		return fmt.Errorf("credit: GrantReferralReward amount must be positive, got %d", amount)
	}

	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		already, err := eventAlreadyProcessed(tx, key)
		if err != nil || already {
			return err
		}
		var users int64
		if err := tx.Model(&sqlitex.User{}).Where("id = ?", referrerID).Count(&users).Error; err != nil {
			return err
		}
		if users == 0 {
			return ErrNoUser
		}

		nowMs := time.Now().UnixMilli()
		if err := ensureAccount(tx, referrerID, nowMs); err != nil {
			return err
		}
		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", referrerID).
			Updates(map[string]interface{}{
				"topup_balance": gorm.Expr("topup_balance + ?", amount),
				"updated_at":    nowMs,
			}).Error; err != nil {
			return err
		}
		var account sqlitex.CreditAccount
		if err := tx.Where("user_id = ?", referrerID).First(&account).Error; err != nil {
			return err
		}
		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:            uuid.New().String(),
			UserId:        referrerID,
			Type:          TypeGrantReferralReward,
			Amount:        amount,
			BalanceAfter:  account.TopupBalance,
			StripeEventId: &key,
			CreatedAt:     nowMs,
		})
	})
}
