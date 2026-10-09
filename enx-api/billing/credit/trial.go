package credit

import (
	"context"
	"errors"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TypeGrantTrial marks the one-off sign-up trial grant (ADR-048).
const TypeGrantTrial = "GRANT_TRIAL"

// now is the ledger's clock for trial expiry; tests replace it.
var now = time.Now

// effectiveTrial is the part of the trial pool that is still spendable: the
// balance (never below zero) until it expires, then nothing.
func effectiveTrial(account sqlitex.CreditAccount, at time.Time) int64 {
	if account.TrialExpiresAt == nil || at.Unix() >= *account.TrialExpiresAt || account.TrialBalance < 0 {
		return 0
	}
	return account.TrialBalance
}

// GrantTrial gives userID the sign-up trial: amount credits that expire
// after ttl. Each account gets it once in its lifetime -- the ledger row's
// idempotency key is "trial:<userID>" -- so a second call, even after the
// first trial expired or was spent, does nothing. An amount of 0 or less is
// the configured "trials off" switch, not an error. granted reports whether
// this call made the grant.
func GrantTrial(ctx context.Context, userID string, amount int64, ttl time.Duration) (granted bool, err error) {
	if amount <= 0 {
		return false, nil
	}
	key := "trial:" + userID

	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		already, err := eventAlreadyProcessed(tx, key)
		if err != nil || already {
			return err
		}

		at := now()
		nowMs := at.UnixMilli()
		if err := ensureAccount(tx, userID, nowMs); err != nil {
			return err
		}
		if err := tx.Model(&sqlitex.CreditAccount{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"trial_balance":    amount,
				"trial_expires_at": at.Add(ttl).Unix(),
				"updated_at":       nowMs,
			}).Error; err != nil {
			return err
		}

		granted = true
		return insertLedgerRow(tx, sqlitex.CreditTransaction{
			Id:            uuid.New().String(),
			UserId:        userID,
			Type:          TypeGrantTrial,
			Amount:        amount,
			BalanceAfter:  amount,
			StripeEventId: &key,
			CreatedAt:     nowMs,
		})
	})
	if err != nil {
		return false, err
	}
	return granted, nil
}

// Trial returns userID's spendable trial credit and when it expires; the
// zero time when no trial was ever granted.
func Trial(ctx context.Context, userID string) (balance int64, expiresAt time.Time, err error) {
	var account sqlitex.CreditAccount
	err = sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, time.Time{}, nil
	}
	if err != nil {
		return 0, time.Time{}, err
	}
	if account.TrialExpiresAt != nil {
		expiresAt = time.Unix(*account.TrialExpiresAt, 0)
	}
	return effectiveTrial(account, now()), expiresAt, nil
}

// expireTrial zeroes a trial pool that has expired with credits left and
// records the forfeit as an EXPIRE row. The UPDATE is conditional on the
// balance just read, so of two racing Settles only one writes the row.
func expireTrial(tx *gorm.DB, userID string, at time.Time) error {
	var account sqlitex.CreditAccount
	if err := tx.Where("user_id = ?", userID).First(&account).Error; err != nil {
		return err
	}
	if account.TrialExpiresAt == nil || at.Unix() < *account.TrialExpiresAt || account.TrialBalance <= 0 {
		return nil
	}
	res := tx.Model(&sqlitex.CreditAccount{}).
		Where("user_id = ? AND trial_balance = ?", userID, account.TrialBalance).
		Update("trial_balance", 0)
	if res.Error != nil || res.RowsAffected == 0 {
		return res.Error
	}
	return insertLedgerRow(tx, sqlitex.CreditTransaction{
		Id:           uuid.New().String(),
		UserId:       userID,
		Type:         TypeExpire,
		Amount:       -account.TrialBalance,
		BalanceAfter: 0,
		Feature:      "trial",
		CreatedAt:    at.UnixMilli(),
	})
}
