package credit

import (
	"context"
	"errors"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
//
// It is also once per email (ADR-062 Decision 3): emailHMAC is the account's
// email HMAC, and an email in trial_grants -- even one whose account was
// deleted -- gets no second trial. The grant writes that record in the same
// transaction. An empty emailHMAC (no email, or no HMAC key) grants nothing:
// the rule cannot be checked, so it fails closed.
func GrantTrial(ctx context.Context, userID, emailHMAC string, amount int64, ttl time.Duration) (granted bool, err error) {
	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		granted, err = grantTrial(tx, userID, emailHMAC, amount, ttl, now())
		return err
	})
	if err != nil {
		return false, err
	}
	return granted, nil
}

// grantTrial is GrantTrial inside the caller's transaction.
func grantTrial(tx *gorm.DB, userID, emailHMAC string, amount int64, ttl time.Duration, at time.Time) (bool, error) {
	if amount <= 0 || emailHMAC == "" {
		return false, nil
	}
	key := "trial:" + userID
	already, err := eventAlreadyProcessed(tx, key)
	if err != nil || already {
		return false, err
	}

	nowMs := at.UnixMilli()
	// The record is the guard: of two accounts with one email, only the one
	// whose insert lands gets the trial. A record this account already owns
	// (the migration's backfill) does not stop it.
	res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&sqlitex.TrialGrant{
		EmailHmac: emailHMAC, UserId: userID, GrantedAt: nowMs,
	})
	if res.Error != nil {
		return false, res.Error
	}
	if res.RowsAffected == 0 {
		var owner int64
		if err := tx.Model(&sqlitex.TrialGrant{}).
			Where("email_hmac = ? AND user_id = ?", emailHMAC, userID).Count(&owner).Error; err != nil || owner == 0 {
			return false, err
		}
	}

	if err := ensureAccount(tx, userID, nowMs); err != nil {
		return false, err
	}
	if err := tx.Model(&sqlitex.CreditAccount{}).
		Where("user_id = ?", userID).
		Updates(map[string]interface{}{
			"trial_balance":    amount,
			"trial_expires_at": at.Add(ttl).Unix(),
			"updated_at":       nowMs,
		}).Error; err != nil {
		return false, err
	}

	return true, insertLedgerRow(tx, sqlitex.CreditTransaction{
		Id:            uuid.New().String(),
		UserId:        userID,
		Type:          TypeGrantTrial,
		Amount:        amount,
		BalanceAfter:  amount,
		StripeEventId: &key,
		CreatedAt:     nowMs,
	})
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
